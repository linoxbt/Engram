/** recall: meaning-addressed search with re-ranking, provenance, and time travel. */
import {
  count8, iso, keywordTerms, mmr, recallId, rrfFuse, scoreCandidate, seqOf, validAt, validSetAt, type EntryMeta,
} from "@engram/core";
import { agentNames, bumpAgentStats, requireScope } from "./agents";
import type { Filter } from "./backend/types";
import { loadChain, patchDerived, type MemDoc } from "./chain";
import type { Ctx } from "./context";
import { embedQuery } from "./embed";
import { RecallInput } from "./schemas";
import type { CheckpointPointer, IntegrityStatus } from "./settings";

export interface RecallMemory {
  id: string;
  seq: number;
  text: string | null;
  kind: string;
  subject: string | null;
  agent: string;
  agentName: string;
  createdAt: string;
  validFrom: string;
  validTo: string | null;
  status: "active" | "superseded" | "forgotten";
  /** As-of answers: was this memory valid at the requested moment? */
  validAtAsOf: boolean;
  conflict: boolean;
  contradictedBy: string[];
  supersedes: string[];
  supersededBy: string | null;
  related: string[];
  score: number;
  distance: number | null;
  hash: string;
  importance: number;
  source: string | null;
  checkpoint: { seq: number; file: string } | null;
  note: string | null;
}

export interface RecallResult {
  query: string;
  asOf: string | null;
  mode: "now" | "as-of" | "as-of-verified";
  memories: RecallMemory[];
  conflicts: number;
  checkpoint: CheckpointPointer | null;
  integrity: IntegrityStatus | null;
  /** Authoritative as-of mode: how many chain entries were replayed. */
  replayed?: number;
  tookMs: number;
}

const BUMP_EVERY_MS = 10 * 60_000;
const BUMPS_PER_RECALL = 3;
const spaceF = (k: string): Filter => ({ op: "eq", path: "metadata.space", values: [k] });

export async function recall(ctx: Ctx, raw: unknown, opts: { log?: boolean } = {}): Promise<RecallResult> {
  requireScope(ctx, "recall");
  const t0 = Date.now();
  const input = RecallInput.parse(raw);
  const { b, space } = ctx;
  const asOf = input.asOf ? iso(input.asOf) : null;
  const vector = await embedQuery(ctx, input.query);

  const filters: Filter[] = [spaceF(space.key)];
  if (asOf) {
    filters.push({ op: "eq", path: "metadata.op", values: ["remember", "reflect"] });
    filters.push({ op: "lte", path: "metadata.createdAt", value: asOf });
  } else if (input.includeSuperseded) {
    filters.push({ op: "eq", path: "metadata.status", values: ["active", "superseded"] });
  } else {
    filters.push({ op: "eq", path: "metadata.status", values: ["active"] });
  }
  if (input.kinds?.length) filters.push({ op: "eq", path: "metadata.kind", values: input.kinds });
  if (input.subject) filters.push({ op: "eq", path: "metadata.subject", values: [input.subject] });
  if (input.agent) filters.push({ op: "eq", path: "metadata.agent", values: [input.agent] });

  const vecLeg = await b.vectors.query<EntryMeta>("memories", { vector, filters, limit: asOf ? 80 : 40 });
  const terms = keywordTerms(input.query);
  const kwLegs = await Promise.all(terms.map((term) =>
    b.vectors.query<EntryMeta>("memories", { filters: [...filters, { op: "contains", path: "metadata.text", value: term }], limit: 20 })));

  const byId = new Map<string, MemDoc>();
  for (const d of vecLeg) byId.set(d.$id, d);
  for (const leg of kwLegs) for (const d of leg) if (!byId.has(d.$id)) byId.set(d.$id, { ...d, $distance: undefined });
  const rrf = rrfFuse([vecLeg.map((d) => d.$id), ...kwLegs.map((l) => l.map((d) => d.$id))]);

  let candidates = [...byId.values()];
  let replayed: number | undefined;
  if (asOf) {
    if (input.verify) {
      const chain = await loadChain(b, space.key);
      replayed = chain.length;
      const valid = validSetAt(chain.map((e) => ({ id: e.$id, h: e.metadata.h })), asOf);
      candidates = candidates.filter((d) => valid.has(d.$id));
    } else {
      candidates = candidates.filter((d) => validAt(d.metadata, asOf));
    }
  }

  const now = asOf ? Date.parse(asOf) : Date.now();
  const scored = candidates.map((d) => {
    const m = d.metadata;
    const { score } = scoreCandidate({
      distance: d.$distance ?? null,
      createdAt: m.createdAt,
      importance: Number(m.h.importance),
      access: Number(m.d.access ?? 0),
      conflict: !asOf && m.conflict === "true",
      rrf: rrf.get(d.$id) ?? 0,
    }, now);
    return { id: d.$id, score, vector: d.embeddings, doc: d };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
  const picked = mmr(scored, input.k, 0.7);

  // Both sides of an open conflict: an agent told to "mention conflicts" must see what the other side says.
  if (!asOf) {
    const have = new Set(picked.map((p) => p.id));
    const partners = [...new Set(picked.flatMap((p) => p.doc.metadata.d.status === "active" ? p.doc.metadata.d.contradictedBy : []))].filter((id) => !have.has(id)).slice(0, 3);
    const docs = (await Promise.all(partners.map((id) => b.vectors.get<EntryMeta>("memories", id)))).filter((d): d is MemDoc => !!d && d.metadata.d.status === "active");
    for (const d of docs) {
      const at = picked.findIndex((p) => p.doc.metadata.d.contradictedBy.includes(d.$id));
      picked.splice(at + 1, 0, { id: d.$id, score: (picked[at]?.score ?? 0) - 0.001, vector: d.embeddings, doc: d });
    }
  }

  // Erased since: memories valid at T whose content was forgotten later. Their vectors are erased too,
  // so they cannot be found by meaning; surface them by subject as receipts.
  let erased: MemDoc[] = [];
  if (asOf) {
    const subjects = [...new Set([input.subject, ...picked.map((p) => p.doc.metadata.subject)].filter((s): s is string => !!s))].slice(0, 5);
    if (subjects.length) {
      erased = (await b.vectors.query<EntryMeta>("memories", {
        filters: [spaceF(space.key), { op: "eq", path: "metadata.status", values: ["forgotten"] }, { op: "eq", path: "metadata.subject", values: subjects }, { op: "lte", path: "metadata.createdAt", value: asOf }, { op: "gt", path: "metadata.forgottenAt", value: asOf }],
        limit: 5, withVectors: false,
      })).filter((d) => (!d.metadata.validTo || d.metadata.validTo > asOf) && !picked.some((p) => p.id === d.$id));
    }
  }

  const docs = [...picked.map((p) => ({ doc: p.doc, score: p.score })), ...erased.map((doc) => ({ doc, score: 0 }))];
  const names = await agentNames(b, docs.map((d) => d.doc.metadata.agent), space);
  const cp = space.settings.latestCheckpoint;
  const memories: RecallMemory[] = docs.map(({ doc, score }) => {
    const m = doc.metadata;
    const seq = seqOf(doc.$id);
    const status = m.d.status as RecallMemory["status"];
    const forgotten = status === "forgotten";
    return {
      id: doc.$id, seq, text: m.c.text, kind: m.kind, subject: m.subject, agent: m.agent, agentName: names[m.agent] ?? m.agent,
      createdAt: m.createdAt, validFrom: m.h.validFrom, validTo: m.d.validTo, status,
      validAtAsOf: asOf ? validAt(m, asOf) : status === "active",
      conflict: m.conflict === "true", contradictedBy: m.d.contradictedBy, supersedes: m.h.refs.supersedes, supersededBy: m.d.supersededBy,
      related: m.h.refs.related, score: Math.round(score * 1000) / 1000, distance: doc.$distance ?? null, hash: m.hash,
      importance: Number(m.h.importance), source: m.h.source,
      checkpoint: cp && seq < cp.size ? { seq: cp.seq, file: cp.fileId } : null,
      note: forgotten ? `${asOf ? "Valid at that time; c" : "C"}ontent erased on ${m.d.forgottenAt?.slice(0, 10)}. The record of erasure is entry #${m.d.forgottenBy ? seqOf(m.d.forgottenBy) : "?"}.` : null,
    };
  });

  if (opts.log !== false) {
    ctx.defer(async () => {
      await logRecall(ctx, input.query, vector, asOf, input.k, memories);
      // Each bump is several writes and moves $updatedAt, which fails concurrent neighbour updates: the top few
      // only, and a memory at most once per BUMP_EVERY_MS. Access is a ranking hint, not a counter anyone audits.
      const due = docs.map((d) => d.doc).filter((d) => d.metadata.d.status !== "forgotten"
        && (!d.metadata.d.lastAccessAt || Date.now() - Date.parse(d.metadata.d.lastAccessAt) >= BUMP_EVERY_MS)).slice(0, BUMPS_PER_RECALL);
      await Promise.all(due.map((d) =>
        patchDerived(b, d.$id, { access: count8(Number(d.metadata.d.access ?? 0) + 1), lastAccessAt: iso() }).catch(() => undefined)));
      await bumpAgentStats(b, ctx.actor, "recalls").catch(() => undefined);
    });
  }

  return {
    query: input.query,
    asOf,
    mode: asOf ? (input.verify ? "as-of-verified" : "as-of") : "now",
    memories,
    conflicts: memories.filter((m) => m.conflict && m.status === "active").length,
    checkpoint: cp,
    integrity: space.settings.integrity,
    replayed,
    tookMs: Date.now() - t0,
  };
}

export interface RecallLogMeta {
  space: string;
  agent: string;
  query: string;
  asOf: string | null;
  k: string;
  topDistance: string | null;
  returned: string[];
  createdAt: string;
}

async function logRecall(ctx: Ctx, query: string, vector: number[], asOf: string | null, k: number, ms: RecallMemory[]) {
  const top = ms.find((m) => m.distance != null)?.distance;
  const meta: RecallLogMeta = {
    space: ctx.space.key, agent: ctx.actor, query, asOf, k: String(k).padStart(2, "0"),
    topDistance: top == null ? null : top.toFixed(4), returned: ms.map((m) => m.id), createdAt: iso(),
  };
  await ctx.b.vectors.create("recalls", recallId(ctx.space.key), { embeddings: vector, metadata: meta }, ctx.b.teamRead(ctx.space.teamId));
}

export async function listRecalls(ctx: Ctx, opts: { limit?: number; agent?: string } = {}) {
  const filters: Filter[] = [spaceF(ctx.space.key)];
  if (opts.agent) filters.push({ op: "eq", path: "metadata.agent", values: [opts.agent] });
  const docs = await ctx.b.vectors.query<RecallLogMeta>("recalls", { filters, order: { field: "$id", dir: "desc" }, limit: opts.limit ?? 100, withVectors: false });
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  return docs.map((d) => ({ id: d.$id, ...d.metadata, agentName: names[d.metadata.agent] ?? d.metadata.agent }));
}

/** Knowledge gaps: recent queries whose best match was far away. */
export async function knowledgeGaps(ctx: Ctx, threshold = 0.45) {
  const logs = await listRecalls(ctx, { limit: 300 });
  const groups = new Map<string, { query: string; count: number; best: number; last: string }>();
  for (const l of logs) {
    const d = l.topDistance == null ? 1 : Number(l.topDistance);
    if (d < threshold) continue;
    const key = l.query.trim().toLowerCase();
    const g = groups.get(key) ?? { query: l.query, count: 0, best: d, last: l.createdAt };
    g.count++; g.best = Math.min(g.best, d); if (l.createdAt > g.last) g.last = l.createdAt;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.best - a.best).slice(0, 25);
}
