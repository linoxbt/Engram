import { seqOf, type ChainEntry, type EntryMeta } from "@engram/core";
import { agentNames, listAgents } from "./agents";
import type { Backend } from "./backend/types";
import { LruCache } from "./cache";
import { chainHead, getEntry, loadChain } from "./chain";
import { loadChainRange } from "./checkpoints";
import type { Ctx } from "./context";
import type { ConceptMeta } from "./concepts";

export interface FeedItem {
  id: string; seq: number; op: string; kind: string; text: string | null; subject: string | null; agent: string; agentName: string;
  createdAt: string; status: string; conflict: boolean; supersedes: number[]; contradicts: number[]; target: number | null; related: number[];
  hash: string; prevHash: string;
}

export function toFeedItem(e: ChainEntry | { $id: string; metadata: EntryMeta }, names: Record<string, string>): FeedItem {
  const m = e.metadata;
  return {
    id: e.$id, seq: seqOf(e.$id), op: m.op, kind: m.kind, text: m.c.text, subject: m.subject, agent: m.agent, agentName: names[m.agent] ?? m.agent,
    createdAt: m.createdAt, status: m.d.status, conflict: m.conflict === "true",
    supersedes: m.h.refs.supersedes.map(seqOf), contradicts: m.h.refs.contradicts.map(seqOf), related: m.h.refs.related.map(seqOf),
    target: m.h.refs.target ? seqOf(m.h.refs.target) : null, hash: m.hash, prevHash: m.h.prevHash,
  };
}

const overviewCache = new Map<string, { at: number; data: Awaited<ReturnType<typeof computeOverview>> }>();

/** Cached for a few seconds so several open dashboards don't each page through the whole chain. */
export async function overview(ctx: Ctx) {
  const hit = overviewCache.get(ctx.space.key);
  if (hit && Date.now() - hit.at < 4000) return { ...hit.data, integrity: ctx.space.settings.integrity, latestCheckpoint: ctx.space.settings.latestCheckpoint };
  const data = await computeOverview(ctx);
  overviewCache.set(ctx.space.key, { at: Date.now(), data });
  return data;
}

/**
 * A per-process summary of every entry of a space, kept up to date incrementally so the Overview and the timeline
 * do not page through the whole chain on every call. Derived fields of old entries only change through entries that
 * reference them (and their conflict partners), so each sync loads the entries after the cached head and re-reads
 * just the memories those touch, plus anything still pending. It rebuilds from the chain when the cached head entry
 * no longer matches what is stored (a reset, a rewrite), when too much changed, and at least every
 * INDEX_FULL_REFRESH_MS, which bounds staleness from out-of-band rewrites such as a repair.
 */
interface Row {
  id: string; seq: number; op: string; status: string; contradictedBy: string[]; hash: string; refs: string[]; pending: boolean;
  subject: string | null; at: string; superseding: boolean;
}
interface ChainIndex { rows: Row[]; builtAt: number; headUpdatedAt: string | undefined }
/** Bounded by rows across every space: one row per entry, so a few long chains are what costs, not many spaces. */
export const CHAIN_INDEX_ROWS = 200_000;
const chainIndex = new LruCache<ChainIndex>(CHAIN_INDEX_ROWS, (v) => Math.max(1, v.rows.length));
const INDEX_FULL_REFRESH_MS = 30_000;
const MAX_INCREMENTAL_REREADS = 200;

function rowOf(e: { $id: string; metadata: EntryMeta }): Row {
  const m = e.metadata;
  const r = m.h.refs;
  return {
    id: e.$id, seq: seqOf(e.$id), op: m.op, status: m.d.status, contradictedBy: [...(m.d.contradictedBy ?? [])], hash: m.hash,
    refs: [...r.supersedes, ...r.contradicts, ...r.related, ...(r.target ? [r.target] : [])], pending: m.applied === "false",
    subject: m.subject, at: m.createdAt, superseding: r.supersedes.length > 0,
  };
}

async function rebuildIndex(b: Backend, key: string, headUpdatedAt: string | undefined): Promise<ChainIndex> {
  const idx = { rows: (await loadChain(b, key)).map(rowOf), builtAt: Date.now(), headUpdatedAt };
  chainIndex.set(key, idx);
  return idx;
}

const syncing = new Map<string, Promise<ChainIndex>>();

/** One sync per space at a time: concurrent callers share it instead of appending the same entries twice. */
export function syncChainIndex(b: Backend, key: string): Promise<ChainIndex> {
  const running = syncing.get(key);
  if (running) return running;
  const p = doSync(b, key).finally(() => { if (syncing.get(key) === p) syncing.delete(key); });
  syncing.set(key, p);
  return p;
}

async function doSync(b: Backend, key: string): Promise<ChainIndex> {
  const head = await chainHead(b, key);
  const cur = chainIndex.get(key);
  if (!head) { const empty = { rows: [], builtAt: Date.now(), headUpdatedAt: undefined }; chainIndex.set(key, empty); return empty; }
  if (!cur || !cur.rows.length || Date.now() - cur.builtAt >= INDEX_FULL_REFRESH_MS) return rebuildIndex(b, key, head.$updatedAt);
  const last = cur.rows[cur.rows.length - 1];
  const headSeq = seqOf(head.$id);
  if (head.$id === last.id && head.$updatedAt === cur.headUpdatedAt && !cur.rows.some((r) => r.pending)) return cur;
  if (headSeq < last.seq) return rebuildIndex(b, key, head.$updatedAt);
  const stored = head.$id === last.id ? head : await getEntry(b, last.id);
  if (!stored || stored.metadata.hash !== last.hash) return rebuildIndex(b, key, head.$updatedAt);
  const added = headSeq > last.seq ? await loadChainRange(b, key, last.seq + 1, headSeq + 1) : [];
  if (added.length !== headSeq - last.seq || added.some((e, i) => seqOf(e.$id) !== last.seq + 1 + i)) return rebuildIndex(b, key, head.$updatedAt);

  const pos = new Map(cur.rows.map((r, i) => [r.id, i]));
  const touched = new Set<string>([last.id]);
  for (const r of [...added.map(rowOf), ...cur.rows.filter((x) => x.pending)]) {
    touched.add(r.id);
    for (const ref of r.refs) {
      touched.add(ref);
      const i = pos.get(ref);
      if (i !== undefined) for (const p of cur.rows[i].contradictedBy) touched.add(p);
    }
  }
  for (const e of added) touched.delete(e.$id);
  if (touched.size > MAX_INCREMENTAL_REREADS) return rebuildIndex(b, key, head.$updatedAt);
  const docs = await Promise.all([...touched].filter((id) => pos.has(id)).map((id) => getEntry(b, id)));
  for (const d of docs) if (d) cur.rows[pos.get(d.$id)!] = rowOf(d);
  cur.rows.push(...added.map(rowOf));
  cur.headUpdatedAt = head.$updatedAt;
  return cur;
}

async function computeOverview(ctx: Ctx) {
  const { b, space } = ctx;
  const [idx, agents, concepts] = await Promise.all([
    syncChainIndex(b, space.key),
    listAgents(b, space.key),
    b.vectors.query<ConceptMeta>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], limit: 500, withVectors: false }),
  ]);
  // The newest entries, read fresh for the feed and the strip.
  const tail = (await b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], order: { field: "$id", dir: "desc" }, limit: 60, withVectors: false,
  })).reverse();
  const rows = idx.rows;
  const memories = rows.filter((e) => e.op === "remember" || e.op === "reflect");
  const count = (s: string) => memories.filter((e) => e.status === s).length;
  const names = await agentNames(b, tail.map((e) => e.metadata.agent), space);
  const conflictPairs = new Set<string>();
  for (const e of memories) if (e.status === "active") for (const p of e.contradictedBy) conflictPairs.add([e.id, p].sort().join("|"));
  return {
    space: { key: space.key, name: space.settings.name, sandbox: space.settings.sandbox, publicVerify: space.settings.publicVerify },
    integrity: space.settings.integrity,
    latestCheckpoint: space.settings.latestCheckpoint,
    stats: {
      entries: rows.length,
      memories: memories.length,
      active: count("active"),
      superseded: count("superseded"),
      forgotten: count("forgotten"),
      conflicts: conflictPairs.size,
      agents: agents.filter((a) => a.status === "active").length,
      concepts: concepts.length,
      forgets: rows.filter((e) => e.op === "forget").length,
      links: rows.filter((e) => e.op === "link").length,
    },
    feed: tail.slice(-30).reverse().map((e) => toFeedItem(e, names)),
    strip: tail.slice(-40).map((e) => ({ seq: seqOf(e.$id), op: e.metadata.op, status: e.metadata.d.status, hash: e.metadata.hash })),
    topConcepts: concepts.map((c) => ({ id: c.$id, label: c.metadata.label || "Unlabelled", members: c.metadata.membersN ?? Number(c.metadata.members) }))
      .sort((a, b) => b.members - a.members).slice(0, 8),
  };
}

/** Subjects, time span and one tick per entry for the timeline, from the incrementally maintained index. */
export async function subjectsOverview(ctx: Ctx) {
  const rows = (await syncChainIndex(ctx.b, ctx.space.key)).rows;
  const counts = new Map<string, number>();
  for (const e of rows) if (e.subject) counts.set(e.subject, (counts.get(e.subject) ?? 0) + 1);
  return {
    subjects: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([subject, count]) => ({ subject, count })),
    span: rows.length ? { first: rows[0].at, last: rows[rows.length - 1].at } : null,
    ticks: rows.map((e) => ({ seq: e.seq, op: e.op, at: e.at, superseding: e.superseding, subject: e.subject })),
  };
}

export async function feed(ctx: Ctx, opts: { limit?: number; after?: number } = {}) {
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }],
    order: { field: "$id", dir: "desc" }, limit: opts.limit ?? 30, withVectors: false,
  });
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  return docs.filter((d) => opts.after == null || seqOf(d.$id) > opts.after).map((d) => toFeedItem(d, names));
}
