import { seqOf, type ChainEntry, type EntryMeta } from "@engram/core";
import { agentNames, listAgents } from "./agents";
import { loadChain } from "./chain";
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

async function computeOverview(ctx: Ctx) {
  const { b, space } = ctx;
  const [chain, agents, concepts] = await Promise.all([
    loadChain(b, space.key),
    listAgents(b, space.key),
    b.vectors.query<ConceptMeta>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], limit: 500, withVectors: false }),
  ]);
  const memories = chain.filter((e) => e.metadata.op === "remember" || e.metadata.op === "reflect");
  const count = (s: string) => memories.filter((e) => e.metadata.d.status === s).length;
  const names = await agentNames(b, chain.slice(-60).map((e) => e.metadata.agent), space);
  const conflictPairs = new Set<string>();
  for (const e of memories) if (e.metadata.d.status === "active") for (const p of e.metadata.d.contradictedBy) conflictPairs.add([e.$id, p].sort().join("|"));
  return {
    space: { key: space.key, name: space.settings.name, sandbox: space.settings.sandbox, publicVerify: space.settings.publicVerify },
    integrity: space.settings.integrity,
    latestCheckpoint: space.settings.latestCheckpoint,
    stats: {
      entries: chain.length,
      memories: memories.length,
      active: count("active"),
      superseded: count("superseded"),
      forgotten: count("forgotten"),
      conflicts: conflictPairs.size,
      agents: agents.filter((a) => a.status === "active").length,
      concepts: concepts.length,
      forgets: chain.filter((e) => e.metadata.op === "forget").length,
      links: chain.filter((e) => e.metadata.op === "link").length,
    },
    feed: chain.slice(-30).reverse().map((e) => toFeedItem(e, names)),
    strip: chain.slice(-40).map((e) => ({ seq: seqOf(e.$id), op: e.metadata.op, status: e.metadata.d.status, hash: e.metadata.hash })),
    topConcepts: concepts.map((c) => ({ id: c.$id, label: c.metadata.label || "Unlabelled", members: c.metadata.membersN ?? Number(c.metadata.members) }))
      .sort((a, b) => b.members - a.members).slice(0, 8),
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
