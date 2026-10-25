/** remember: embed, find neighbours, relate, append to the chain, then post-commit work. */
import { count8, iso, randomSalt, seqOf, sha256Hex, type EntryMeta } from "@engram/core";
import { agentNames, bumpAgentStats, requireScope } from "./agents";
import { append, applyPending, patchDerived, type MemDoc } from "./chain";
import { assignConcept } from "./concepts";
import { requestCheckpoint } from "./checkpoints";
import type { Ctx } from "./context";
import { embedDocument } from "./embed";
import { EngramError, isConflict } from "./errors";
import {
  effective, modelFor, notesOf, relate, THRESHOLDS, type Neighbour, type Relation, type RelationKind, type RelationNotes, type RelationVia,
} from "./relate";
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
  /**
   * Demo story: the relations the story needs. With a classifier model the real relate path runs and its verdict
   * is used when it matches; otherwise these are used, recorded with via "scripted".
   */
  scripted?: Relation[];
  skipRelate?: boolean;
  /** Seed only: an idempotency marker stored on the entry without taking the lock (seeding resumes by it). */
  idem?: string;
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
  const { b } = ctx;

  // Idempotency keys belong to the agent that sent them; another agent's key never matches.
  const actor = opts.agent ?? ctx.actor;
  const idem = input.idempotencyKey ? `${actor}:${input.idempotencyKey}` : null;
  const marker = idem ?? opts.idem ?? null;
  const replay = async () => {
    const [hit] = await b.vectors.query<EntryMeta>("memories", { filters: [spaceF(ctx), { op: "eq", path: "metadata.idem", values: [idem!] }], limit: 1, withVectors: false });
    return hit ? { id: hit.$id, seq: seqOf(hit.$id), hash: hit.metadata.hash, status: "created" as const, relations: refsAsRelations(hit.metadata), relateStatus: hit.metadata.d.relateStatus } : null;
  };

  // Independent round trips run side by side: the idempotency lock (then the replay check under it), the rate
  // limit, the embedding, and applying earlier pending entries, which must land before neighbours' status is read.
  // Two retries racing each other would both miss a plain lookup; the create-first lock lets only one write.
  const [lockR, rateR, vecR, pendR] = await Promise.allSettled([
    idem ? takeIdemLock(ctx, idem, replay) : Promise.resolve(null),
    opts.createdAt ? Promise.resolve() : enforceRate(ctx),
    opts.vector ? Promise.resolve(opts.vector) : embedDocument(ctx, input.text),
    applyPending(ctx),
  ]);
  if (lockR.status === "rejected") throw lockR.reason;
  const lock = lockR.value;
  // A retry of a write that already landed gets its result back, even past the rate limit.
  if (lock && "id" in lock) return lock;
  try {
    for (const r of [rateR, vecR, pendR]) if (r.status === "rejected") throw r.reason;
    const result = await write(ctx, input, opts, marker, (vecR as PromiseFulfilledResult<number[]>).value);
    // Releasing after the response is safe: until then a retry finds the lock, then the entry.
    if (lock) ctx.defer(() => lock.release());
    return result;
  } catch (e) {
    if (lock) await lock.release();
    throw e;
  }
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

async function takeIdemLock(ctx: Ctx, idem: string, replay: () => Promise<RememberResult | null>): Promise<{ release: () => Promise<void> } | RememberResult> {
  const { files } = ctx.b;
  const bucket = ctx.cfg.appwrite.checkpointsBucket;
  const fileId = `idm_${ctx.space.key}_${(await sha256Hex(idem)).slice(0, 24)}`;
  // A token per holder: release deletes the lock only while it is still ours. A lock judged stale and reclaimed
  // by another writer belongs to that writer, and deleting it would let a third writer in beside it.
  const body = new TextEncoder().encode(JSON.stringify({ at: iso(), token: randomSalt() }));
  const release = async () => {
    const cur = await files.get(bucket, fileId).catch(() => null);
    if (sameBytes(cur, body)) await files.delete(bucket, fileId).catch(() => undefined);
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await files.put(bucket, fileId, `${fileId}.json`, body, ctx.b.teamRead(ctx.space.teamId));
    } catch (e) {
      if (!isConflict(e)) throw e;
      const hit = await replay();
      if (hit) return hit;
      // A writer that died holding the lock must not block the key forever.
      const raw = await files.get(bucket, fileId);
      if (!raw) continue;
      let at = 0;
      try { at = Date.parse(JSON.parse(new TextDecoder().decode(raw)).at); } catch { at = 0; }
      if (Date.now() - (at || 0) > 60_000) {
        // Remove only the exact stale lock judged above, never a fresh one another writer took meanwhile.
        if (sameBytes(await files.get(bucket, fileId), raw)) await files.delete(bucket, fileId).catch(() => undefined);
        continue;
      }
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    // Acquired. The holder we waited for (or one that finished just before our create) may have written already.
    const hit = await replay();
    if (hit) { await release(); return hit; }
    return { release };
  }
  throw new EngramError("chain_busy", "A request with this idempotency key is still in progress. Retry with the same key.");
}

/** Supersessions caused by one writer's classified memories: per write, and per writer per hour. */
export const SUPERSEDE_PER_WRITE = 2;
export const SUPERSEDE_PER_HOUR = 10;

/** How many memories this writer retired in the last hour (its own remembers and supersede links). */
async function supersessionsLastHour(ctx: Ctx, actor: string, stopAt: number): Promise<number> {
  const filters: Filter[] = [spaceF(ctx), { op: "eq", path: "metadata.agent", values: [actor] }, { op: "eq", path: "metadata.op", values: ["remember", "link"] },
    { op: "gte", path: "metadata.createdAt", value: iso(Date.now() - 3_600_000) }];
  let n = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await ctx.b.vectors.query<EntryMeta>("memories", { filters, order: { field: "$id", dir: "desc" }, limit: 200, cursorAfter: cursor, withVectors: false });
    for (const d of page) n += d.metadata.op === "link" ? (d.metadata.kind === "supersede" ? 1 : 0) : d.metadata.h.refs.supersedes.length;
    if (n >= stopAt || page.length < 200) return n;
    cursor = page[page.length - 1].$id;
  }
}

/**
 * One write may retire at most two memories on a classifier's word, and one writer at most ten an hour; further
 * "supersedes" become conflicts for a person to settle, so one crafted memory (or a burst of them) cannot wipe a
 * neighbourhood. Applies to the first classification and to the background retry alike.
 */
export async function capSupersessions(ctx: Ctx, actor: string, relations: Relation[]): Promise<Relation[]> {
  const wanted = relations.filter((r) => r.relation === "supersedes" && r.confidence >= THRESHOLDS.supersedes).length;
  if (!wanted) return relations;
  const used = await supersessionsLastHour(ctx, actor, SUPERSEDE_PER_HOUR);
  let budget = Math.min(SUPERSEDE_PER_WRITE, Math.max(0, SUPERSEDE_PER_HOUR - used));
  return relations.map((r) => {
    if (r.relation !== "supersedes" || r.confidence < THRESHOLDS.supersedes || budget-- > 0) return r;
    return { ...r, relation: "contradicts" as const, reason: `${r.reason} Over the supersession limit, so a person decides.`.trim() };
  });
}

const noteable = (r: Relation) => r.relation === "supersedes" || r.relation === "contradicts" || r.relation === "refines";
const notesFrom = (rs: Relation[], via: RelationVia): RelationNotes =>
  Object.fromEntries(rs.filter(noteable).map((r) => [r.id, { relation: r.relation, reason: r.reason, via }]));

async function write(ctx: Ctx, input: RememberInput, opts: RememberOptions, idem: string | null, vector: number[]): Promise<RememberResult> {
  const { b, space } = ctx;
  const actor = opts.agent ?? ctx.actor;
  const createdAt = opts.createdAt ?? iso();
  let relations: Relation[] = [];
  let relateStatus: RememberResult["relateStatus"] = "skipped";
  let via: RelationVia = "scripted";
  const near = new Map<string, MemDoc>();
  const model = modelFor(ctx);

  if (opts.relations || (opts.scripted && !model)) {
    relations = opts.relations ?? opts.scripted!;
    relateStatus = "done";
  } else if (!opts.skipRelate || opts.scripted) {
    for (const n of await nearestActive(ctx, vector, 5, space.settings.neighbourDistance)) near.set(n.$id, n);
    if (near.size) {
      const docs = [...near.values()];
      // Display names only go into the model's prompt; the rule-based classifier does not need the lookups.
      const names = model ? await agentNames(b, docs.map((n) => n.metadata.agent), space) : {};
      const neighbours: Neighbour[] = docs.map((n) => ({
        id: n.$id, text: n.metadata.c.text ?? "", createdAt: n.metadata.createdAt, agent: n.metadata.agent,
        agentName: names[n.metadata.agent] ?? n.metadata.agent, subject: n.metadata.subject, kind: n.metadata.kind, distance: n.$distance ?? 1,
      }));
      const res = await relate(ctx, { text: input.text, kind: input.kind, subject: input.subject ?? null, createdAt, agentName: opts.agentName ?? ctx.actorName, agent: actor }, neighbours);
      relations = opts.scripted ? res.relations : await capSupersessions(ctx, actor, res.relations);
      relateStatus = res.status;
      via = res.via === "heuristic" ? "heuristic" : "model";
    }
    if (opts.scripted) {
      // Demo story: the real classifier decides when it reaches the story's verdict on its own. If it is
      // unavailable, or disagrees in a way that would break the story, the scripted relation is used and recorded
      // as scripted, so the conflict inbox never presents a scripted pair as the engine's finding.
      const got = effective(relations);
      const agrees = via === "model" && relateStatus === "done"
        && opts.scripted.every((s) => got.some((r) => r.id === s.id && r.relation === s.relation))
        && got.every((r) => r.relation === "refines" || opts.scripted!.some((s) => s.id === r.id));
      if (!agrees) { relations = opts.scripted; relateStatus = "done"; via = "scripted"; }
    }
  }

  const eff = effective(relations);
  const dup = eff.find((r) => r.relation === "duplicate");
  if (dup) {
    const doc = near.get(dup.id) ?? (await b.vectors.get<EntryMeta>("memories", dup.id));
    if (doc) {
      await patchDerived(b, dup.id, { access: count8(Number(doc.metadata.d.access) + 1), lastAccessAt: iso() });
      return { id: dup.id, seq: seqOf(dup.id), hash: doc.metadata.hash, status: "duplicate", relations: decorate(eff), relateStatus };
    }
  }

  const reasons = notesFrom(eff, via);
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
    extra: Object.keys(reasons).length ? { reasons } : undefined,
  }, { pendingChecked: true });

  ctx.defer(() => postCommit(ctx, res.id, res.seq, vector, actor, relateStatus === "pending" ? input : null));
  return { id: res.id, seq: res.seq, hash: res.hash, status: "created", relations: decorate(eff), relateStatus };
}

const decorate = (rs: Relation[]) => rs.map((r) => ({ id: r.id, seq: seqOf(r.id), relation: r.relation, reason: r.reason, confidence: r.confidence }));

function refsAsRelations(m: EntryMeta): RememberResult["relations"] {
  const notes = notesOf(m.d);
  const out: RememberResult["relations"] = [];
  for (const id of m.h.refs.supersedes) out.push({ id, seq: seqOf(id), relation: "supersedes", reason: notes[id]?.reason ?? "", confidence: 1 });
  for (const id of m.h.refs.contradicts) out.push({ id, seq: seqOf(id), relation: "contradicts", reason: notes[id]?.reason ?? "", confidence: 1 });
  for (const id of m.h.refs.related) out.push({ id, seq: seqOf(id), relation: "refines", reason: notes[id]?.reason ?? "", confidence: 1 });
  return out;
}

async function postCommit(ctx: Ctx, id: string, seq: number, vector: number[], actor: string, pending: RememberInput | null) {
  const jobs: Promise<unknown>[] = [
    assignConcept(ctx, id, vector).catch((e) => console.error("[engram] concept assignment failed", e)),
    bumpAgentStats(ctx.b, actor, "writes").catch(() => undefined),
  ];
  if ((seq + 1) % Math.max(1, ctx.space.settings.checkpointEvery) === 0) jobs.push(requestCheckpoint(ctx).catch((e) => console.error("[engram] checkpoint failed", e)));
  if (pending) jobs.push(retryRelate(ctx, id, vector, pending, actor).catch((e) => console.error("[engram] relate retry failed", e)));
  await Promise.all(jobs);
}

/**
 * A write whose classification timed out: classify again with more time and record findings as link entries.
 * The same caps as the first pass apply, and the rule-based fallback cannot retire another agent's memory.
 */
export async function retryRelate(ctx: Ctx, id: string, vector: number[], input: RememberInput, actor = ctx.actor) {
  const { linkFound } = await import("./forget");
  const near = (await nearestActive(ctx, vector, 6, ctx.space.settings.neighbourDistance)).filter((n) => n.$id !== id && n.$id < id);
  if (!near.length) { await patchDerived(ctx.b, id, { relateStatus: "done" }); return; }
  const [names, doc] = await Promise.all([agentNames(ctx.b, near.map((n) => n.metadata.agent), ctx.space), ctx.b.vectors.get<EntryMeta>("memories", id)]);
  // Forgotten meanwhile: nothing to classify, and its text must not reach a model again.
  if (!doc || doc.metadata.d.status === "forgotten" || doc.metadata.c.text == null) return;
  const res = await relate(ctx, { text: input.text, kind: input.kind, subject: input.subject ?? null, createdAt: doc.metadata.createdAt, agentName: ctx.actorName, agent: actor },
    near.map((n) => ({ id: n.$id, text: n.metadata.c.text ?? "", createdAt: n.metadata.createdAt, agent: n.metadata.agent, agentName: names[n.metadata.agent] ?? n.metadata.agent, subject: n.metadata.subject, kind: n.metadata.kind, distance: n.$distance ?? 1 })),
    { timeoutMs: 15_000, fallback: true });
  if (res.status === "pending") return;
  const found = effective(await capSupersessions(ctx, actor, res.relations)).filter((r) => r.relation === "supersedes" || r.relation === "contradicts");
  const via: RelationVia = res.via === "heuristic" ? "heuristic" : "model";
  for (const r of found) {
    await linkFound(ctx, { target: r.id, other: id, kind: r.relation === "supersedes" ? "supersede" : "contradict", reason: r.reason, via });
  }
  // Reasons live on the newer memory (derived, erasable), where the conflict inbox looks for them.
  const notes = notesFrom(found, via);
  await patchDerived(ctx.b, id, (d) => ({ relateStatus: "done", ...(found.length ? { reasons: { ...notesOf(d), ...notes } } : {}) }));
}
