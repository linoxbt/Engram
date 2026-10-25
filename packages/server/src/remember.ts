/** remember: embed, find neighbours, relate, append to the chain, then post-commit work. */
import { count8, iso, seqOf, sha256Hex, type EntryMeta } from "@engram/core";
import { agentNames, bumpAgentStats, requireScope } from "./agents";
import { append, applyPending, patchDerived, type MemDoc } from "./chain";
import { assignConcept } from "./concepts";
import { requestCheckpoint } from "./checkpoints";
import type { Ctx } from "./context";
import { embedDocument } from "./embed";
import { EngramError, isConflict } from "./errors";
import { effective, relate, THRESHOLDS, type Neighbour, type Relation, type RelationKind } from "./relate";
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

  // Idempotency keys belong to the agent that sent them; another agent's key never matches.
  const actor = opts.agent ?? ctx.actor;
  const idem = input.idempotencyKey ? `${actor}:${input.idempotencyKey}` : null;
  const replay = async () => {
    const [hit] = await b.vectors.query<EntryMeta>("memories", { filters: [spaceF(ctx), { op: "eq", path: "metadata.idem", values: [idem!] }], limit: 1, withVectors: false });
    return hit ? { id: hit.$id, seq: seqOf(hit.$id), hash: hit.metadata.hash, status: "created" as const, relations: refsAsRelations(hit.metadata), relateStatus: hit.metadata.d.relateStatus } : null;
  };
  if (idem) {
    const hit = await replay();
    if (hit) return hit;
  }
  if (!opts.createdAt) await enforceRate(ctx);
  // Two retries racing each other would both miss the lookup above; a create-first lock lets only one write.
  const lock = idem ? await takeIdemLock(ctx, idem, replay) : null;
  if (lock && "id" in lock) return lock;
  try {
    return await write(ctx, input, opts, idem);
  } finally {
    if (lock) await lock.release();
  }
}

async function takeIdemLock(ctx: Ctx, idem: string, replay: () => Promise<RememberResult | null>): Promise<{ release: () => Promise<void> } | RememberResult> {
  const bucket = ctx.cfg.appwrite.checkpointsBucket;
  const fileId = `idm_${ctx.space.key}_${(await sha256Hex(idem)).slice(0, 24)}`;
  const release = () => ctx.b.files.delete(bucket, fileId).catch(() => undefined);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await ctx.b.files.put(bucket, fileId, `${fileId}.json`, new TextEncoder().encode(JSON.stringify({ at: iso() })), ctx.b.teamRead(ctx.space.teamId));
      return { release };
    } catch (e) {
      if (!isConflict(e)) throw e;
      const hit = await replay();
      if (hit) return hit;
      // A writer that died holding the lock must not block the key forever.
      const raw = await ctx.b.files.get(bucket, fileId);
      let at = 0;
      try { at = raw ? Date.parse(JSON.parse(new TextDecoder().decode(raw)).at) : 0; } catch { at = 0; }
      if (Date.now() - at > 60_000) { await release(); continue; }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new EngramError("chain_busy", "A request with this idempotency key is still in progress. Retry with the same key.");
}

async function write(ctx: Ctx, input: RememberInput, opts: RememberOptions, idem: string | null): Promise<RememberResult> {
  const { b, space } = ctx;

  const vector = opts.vector ?? (await embedDocument(ctx, input.text));
  // Earlier entries' effects must be in place before we look at neighbours' status.
  await applyPending(ctx);
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
      // One write may retire at most two memories on a classifier's word; further "supersedes" become conflicts
      // for a person to settle, so one crafted memory cannot wipe a neighbourhood.
      let retired = 0;
      relations = res.relations.map((r) => (r.relation === "supersedes" && r.confidence >= THRESHOLDS.supersedes && ++retired > 2 ? { ...r, relation: "contradicts" as const } : r));
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
    idem,
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

/** A write whose classification timed out: classify again with more time and record findings as link entries. Exported for the sentinel sweep. */
export async function retryRelate(ctx: Ctx, id: string, vector: number[], input: Pick<RememberInput, "text" | "kind" | "subject">) {
  const { linkFound } = await import("./forget");
  const near = (await nearestActive(ctx, vector, 6, ctx.space.settings.neighbourDistance)).filter((n) => n.$id !== id && n.$id < id);
  if (!near.length) { await patchDerived(ctx.b, id, { relateStatus: "done" }); return; }
  const names = await agentNames(ctx.b, near.map((n) => n.metadata.agent), ctx.space);
  const doc = await ctx.b.vectors.get<EntryMeta>("memories", id);
  const res = await relate(ctx, { text: input.text, kind: input.kind, subject: input.subject ?? null, createdAt: doc?.metadata.createdAt ?? iso(), agentName: ctx.actorName },
    near.map((n) => ({ id: n.$id, text: n.metadata.c.text ?? "", createdAt: n.metadata.createdAt, agent: n.metadata.agent, agentName: names[n.metadata.agent] ?? n.metadata.agent, subject: n.metadata.subject, kind: n.metadata.kind, distance: n.$distance ?? 1 })),
    { timeoutMs: 15_000, fallback: true });
  if (res.status === "pending") return;
  for (const r of effective(res.relations)) {
    if (r.relation === "supersedes") await linkFound(ctx, { target: r.id, other: id, kind: "supersede", reason: r.reason });
    if (r.relation === "contradicts") await linkFound(ctx, { target: r.id, other: id, kind: "contradict", reason: r.reason });
  }
  await patchDerived(ctx.b, id, { relateStatus: "done" });
}
