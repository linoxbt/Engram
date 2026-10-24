/** remember: embed, find neighbours, relate, append to the chain, then post-commit work. */
import { count8, iso, seqOf, type EntryMeta } from "@engram/core";
import { agentNames, bumpAgentStats, requireScope } from "./agents";
import { append, patchDerived, type MemDoc } from "./chain";
import { assignConcept } from "./concepts";
import { requestCheckpoint } from "./checkpoints";
import type { Ctx } from "./context";
import { embedDocument } from "./embed";
import { EngramError } from "./errors";
import { effective, relate, type Neighbour, type Relation, type RelationKind } from "./relate";
import { RememberInput } from "./schemas";
import type { Filter } from "./backend/types";

export interface RememberResult {
  id: string;
  seq: number;
  hash: string;
  status: "created" | "duplicate";
  relations: { id: string; seq: number; relation: RelationKind; reason: string; confidence: number }[];
  relateStatus: "done" | "pending" | "skipped";
}

export interface RememberOptions {
  /** Seed only: explicit timestamp, precomputed vector, scripted relations, author override. */
  createdAt?: string;
  vector?: number[];
  relations?: Relation[];
  skipRelate?: boolean;
  agent?: string;
  agentName?: string;
}

const spaceF = (ctx: Ctx): Filter => ({ op: "eq", path: "metadata.space", values: [ctx.space.key] });

export async function nearestActive(ctx: Ctx, vector: number[], k: number, maxDistance: number): Promise<MemDoc[]> {
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    vector,
    filters: [spaceF(ctx), { op: "eq", path: "metadata.status", values: ["active"] }, { op: "eq", path: "metadata.op", values: ["remember", "reflect"] }],
    limit: k,
    withVectors: false,
  });
  return docs.filter((d) => (d.$distance ?? 1) < maxDistance);
}

async function enforceRate(ctx: Ctx) {
  if (ctx.actor.startsWith("user:")) return;
  const since = iso(Date.now() - 60_000);
  const recent = await ctx.b.vectors.query("memories", {
    filters: [spaceF(ctx), { op: "eq", path: "metadata.agent", values: [ctx.actor] }, { op: "gte", path: "metadata.createdAt", value: since }],
    limit: 61,
    withVectors: false,
  });
  if (recent.length > 60) throw new EngramError("rate_limited", "This agent wrote more than 60 memories in the last minute.");
}

export async function remember(ctx: Ctx, raw: unknown, opts: RememberOptions = {}): Promise<RememberResult> {
  requireScope(ctx, "remember");
  if (typeof raw === "object" && raw && typeof (raw as { text?: unknown }).text === "string" && (raw as { text: string }).text.length > 2000) {
    throw new EngramError("too_large", "Memories are limited to 2,000 characters. Split long text into several self-contained memories.");
  }
  const input = RememberInput.parse(raw);
  const { b, space } = ctx;

  if (input.idempotencyKey) {
    const [hit] = await b.vectors.query<EntryMeta>("memories", { filters: [spaceF(ctx), { op: "eq", path: "metadata.idem", values: [input.idempotencyKey] }], limit: 1, withVectors: false });
    if (hit) return { id: hit.$id, seq: seqOf(hit.$id), hash: hit.metadata.hash, status: "created", relations: refsAsRelations(hit.metadata), relateStatus: hit.metadata.d.relateStatus };
  }
  if (!opts.createdAt) await enforceRate(ctx);

  const vector = opts.vector ?? (await embedDocument(ctx, input.text));
  const createdAt = opts.createdAt ?? iso();
  let relations: Relation[] = [];
  let relateStatus: RememberResult["relateStatus"] = "skipped";

  if (opts.relations) {
    relations = opts.relations;
    relateStatus = "done";
  } else if (!opts.skipRelate) {
    const near = await nearestActive(ctx, vector, 5, space.settings.neighbourDistance);
    if (near.length) {
      const names = await agentNames(b, near.map((n) => n.metadata.agent), space);
      const neighbours: Neighbour[] = near.map((n) => ({
        id: n.$id, text: n.metadata.c.text ?? "", createdAt: n.metadata.createdAt, agent: n.metadata.agent,
        agentName: names[n.metadata.agent] ?? n.metadata.agent, subject: n.metadata.subject, kind: n.metadata.kind, distance: n.$distance ?? 1,
      }));
      const res = await relate(ctx, { text: input.text, kind: input.kind, subject: input.subject ?? null, createdAt, agentName: opts.agentName ?? ctx.actorName }, neighbours);
      relations = res.relations;
      relateStatus = res.status;
    }
  }

  const eff = effective(relations);
  const dup = eff.find((r) => r.relation === "duplicate");
  if (dup) {
    const doc = await b.vectors.get<EntryMeta>("memories", dup.id);
    if (doc) {
      await patchDerived(b, dup.id, { access: count8(Number(doc.metadata.d.access) + 1), lastAccessAt: iso() });
      return { id: dup.id, seq: seqOf(dup.id), hash: doc.metadata.hash, status: "duplicate", relations: decorate(eff), relateStatus };
    }
  }

  const res = await append(ctx, {
    op: "remember",
    kind: input.kind,
    subject: input.subject ?? null,
    text: input.text,
    vector,
    importance: input.importance,
    confidence: input.confidence,
    source: input.source ?? null,
    validFrom: input.validFrom ?? null,
    refs: {
      supersedes: eff.filter((r) => r.relation === "supersedes").map((r) => r.id),
      contradicts: eff.filter((r) => r.relation === "contradicts").map((r) => r.id),
      related: eff.filter((r) => r.relation === "refines").map((r) => r.id),
    },
    idem: input.idempotencyKey ?? null,
    relateStatus,
    createdAt: opts.createdAt,
    agent: opts.agent,
  });

  const actor = opts.agent ?? ctx.actor;
  ctx.defer(() => postCommit(ctx, res.id, res.seq, vector, actor, relateStatus === "pending" ? input : null));
  return { id: res.id, seq: res.seq, hash: res.hash, status: "created", relations: decorate(eff), relateStatus };
}

const decorate = (rs: Relation[]) => rs.map((r) => ({ id: r.id, seq: seqOf(r.id), relation: r.relation, reason: r.reason, confidence: r.confidence }));

function refsAsRelations(m: EntryMeta): RememberResult["relations"] {
  const out: RememberResult["relations"] = [];
  for (const id of m.h.refs.supersedes) out.push({ id, seq: seqOf(id), relation: "supersedes", reason: "", confidence: 1 });
  for (const id of m.h.refs.contradicts) out.push({ id, seq: seqOf(id), relation: "contradicts", reason: "", confidence: 1 });
  for (const id of m.h.refs.related) out.push({ id, seq: seqOf(id), relation: "refines", reason: "", confidence: 1 });
  return out;
}

async function postCommit(ctx: Ctx, id: string, seq: number, vector: number[], actor: string, pending: RememberInput | null) {
  const jobs: Promise<unknown>[] = [
    assignConcept(ctx, id, vector).catch((e) => console.error("[engram] concept assignment failed", e)),
    bumpAgentStats(ctx.b, actor, "writes").catch(() => undefined),
  ];
  if ((seq + 1) % Math.max(1, ctx.space.settings.checkpointEvery) === 0) jobs.push(requestCheckpoint(ctx).catch((e) => console.error("[engram] checkpoint failed", e)));
  if (pending) jobs.push(retryRelate(ctx, id, vector, pending).catch((e) => console.error("[engram] relate retry failed", e)));
  await Promise.all(jobs);
}

/** A write whose classification timed out: classify again with more time and record findings as link entries. */
async function retryRelate(ctx: Ctx, id: string, vector: number[], input: RememberInput) {
  const { linkFound } = await import("./forget");
  const near = (await nearestActive(ctx, vector, 6, ctx.space.settings.neighbourDistance)).filter((n) => n.$id !== id && n.$id < id);
  if (!near.length) { await patchDerived(ctx.b, id, { relateStatus: "done" }); return; }
  const names = await agentNames(ctx.b, near.map((n) => n.metadata.agent), ctx.space);
  const doc = await ctx.b.vectors.get<EntryMeta>("memories", id);
  const res = await relate(ctx, { text: input.text, kind: input.kind, subject: input.subject ?? null, createdAt: doc?.metadata.createdAt ?? iso(), agentName: ctx.actorName },
    near.map((n) => ({ id: n.$id, text: n.metadata.c.text ?? "", createdAt: n.metadata.createdAt, agent: n.metadata.agent, agentName: names[n.metadata.agent] ?? n.metadata.agent, subject: n.metadata.subject, kind: n.metadata.kind, distance: n.$distance ?? 1 })),
    { timeoutMs: 15_000 });
  if (res.status === "pending") return;
  for (const r of effective(res.relations)) {
    if (r.relation === "supersedes") await linkFound(ctx, { target: r.id, other: id, kind: "supersede", reason: r.reason });
    if (r.relation === "contradicts") await linkFound(ctx, { target: r.id, other: id, kind: "contradict", reason: r.reason });
  }
  await patchDerived(ctx.b, id, { relateStatus: "done" });
}
