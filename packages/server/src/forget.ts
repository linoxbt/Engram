/** forget (provable erasure) and link entries (conflict resolution, late findings). */
import { seqOf, tombstoneVector, type EntryMeta, type LinkKind } from "@engram/core";
import { agentNames, requireScope } from "./agents";
import { append, applyPending, patchDerived, queryAll, type MemDoc } from "./chain";
import { scrubConcept } from "./concepts";
import { COLLECTION_DIMS, type Ctx } from "./context";
import { EngramError, isEngramError } from "./errors";
import { notesOf, type RelationNote, type RelationVia } from "./relate";
import type { RecallLogMeta } from "./recall";
import { ForgetInput, ResolveInput } from "./schemas";

export interface ForgetResult { forgetEntryId: string; seq: number; target: string; targetSeq: number; status: "forgotten"; erased: boolean }

/** The forget entry already appended for a memory, if any (a retry after a 500 while erasure was pending). */
async function existingForget(ctx: Ctx, target: string): Promise<MemDoc | null> {
  const [hit] = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.op", values: ["forget"] }, { op: "eq", path: "metadata.h.refs.target", values: [target] }],
    order: { field: "$id", dir: "asc" }, limit: 1, withVectors: false,
  });
  return hit ?? null;
}

/**
 * Append a forget entry, then erase the target's text, salt and vector. The
 * target's header and hash stay untouched, so the chain still verifies: the
 * header covers the salted content hash, never the text.
 *
 * Idempotent: a retry finds the forget entry already in the chain, finishes its erasure and returns it, instead of
 * appending a second one.
 */
export async function forget(ctx: Ctx, raw: unknown, opts: { createdAt?: string; idem?: string; depth?: number } = {}): Promise<ForgetResult> {
  requireScope(ctx, "forget");
  const input = ForgetInput.parse(raw);
  const [target, prior] = await Promise.all([ctx.b.vectors.get<EntryMeta>("memories", input.id), existingForget(ctx, input.id)]);
  if (!target || target.metadata.space !== ctx.space.key) throw new EngramError("not_found", `Memory ${input.id} not found in this space.`);
  const m = target.metadata;
  if (m.op !== "remember" && m.op !== "reflect") throw new EngramError("bad_request", "Only memories can be forgotten, not forget or link entries.");
  if (m.d.status === "forgotten") throw new EngramError("conflict", `Memory #${seqOf(input.id)} was already forgotten by ${m.d.forgottenBy}.`);

  const res = prior
    ? { id: prior.$id, seq: seqOf(prior.$id), derivedPending: true }
    : await append(ctx, {
      op: "forget",
      kind: "tombstone",
      subject: m.subject,
      text: input.reason || null,
      refs: { target: input.id },
      createdAt: opts.createdAt,
      idem: opts.idem ?? null,
    });
  let erased = !res.derivedPending;
  if (!erased) {
    // Erasure is a promise: keep trying in the background until it lands.
    // In chain order: earlier pending entries land first, so the erasure leaves the state the replay computes.
    erased = !(await applyPending(ctx, { through: res.id, attempts: 8 })).blocked;
    if (!erased) ctx.defer(() => applyPending(ctx, { through: res.id, attempts: 20 }));
  }
  // Text also lives on in places built from it: concept labels, reflect summaries, recall logs, classifier reasons.
  await eraseCopies(ctx, input.id, m.d.concept ?? null, opts.depth ?? 0).catch((e) => {
    console.error("[engram] erasing copies failed; retrying in the background", e);
    ctx.defer(() => retryEraseCopies(ctx, input.id, m.d.concept ?? null, opts.depth ?? 0));
  });
  return { forgetEntryId: res.id, seq: res.seq, target: input.id, targetSeq: seqOf(input.id), status: "forgotten", erased };
}

/** A space has one reflect summary per concept, so this is far above any real count and still bounded. */
const MAX_REFLECTIONS = 20_000;
/** A summary derived from a summary cascades; beyond this the chain is left to the next forget or sweep. */
const MAX_CASCADE = 4;
/** Recall logs are read a page at a time, so the collection never sits in memory however large it has grown. */
const RECALL_PAGE = 500;
/** Attempts, with a growing pause between them, before an erasure that keeps failing is left to the next pass. */
export const ERASE_ATTEMPTS = 3;
const ERASE_BACKOFF_MS = 250;

/** Bounded, backed-off retries. Re-queueing the identical failing work at once only multiplied the load. */
export async function retryEraseCopies(ctx: Ctx, target: string, concept: string | null, depth = 0) {
  for (let attempt = 2; attempt <= ERASE_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, ERASE_BACKOFF_MS * (attempt - 1)));
    try { await eraseCopies(ctx, target, concept, depth); return; }
    catch (e) { console.error(`[engram] erasing copies for ${target} failed (attempt ${attempt} of ${ERASE_ATTEMPTS})`, e); }
  }
  console.error(`[engram] gave up erasing copies for ${target} in this run; the next forget or sentinel sweep retries it`);
}

export async function eraseCopies(ctx: Ctx, target: string, concept: string | null, depth = 0) {
  const { b, space } = ctx;
  const spaceF = { op: "eq" as const, path: "metadata.space", values: [space.key] };
  // The concept as of now too: one assigned after the caller read the memory may carry a label built from it.
  const now = await b.vectors.get<EntryMeta>("memories", target);
  for (const c of new Set([concept, now?.metadata.d.concept ?? null])) if (c) await scrubConcept(ctx, c, target);
  // Summaries derived from the memory restate it, so they are forgotten too (and cascade in turn). Every page:
  // a summary past the first page must not keep the text.
  if (depth < MAX_CASCADE) {
    const reflections = await queryAll<EntryMeta>(b, "memories", { filters: [spaceF, { op: "eq", path: "metadata.op", values: ["reflect"] }] }, MAX_REFLECTIONS);
    for (const r of reflections) {
      if (r.metadata.d.status === "forgotten" || !r.metadata.h.refs.derivedFrom.includes(target)) continue;
      await forget(ctx, { id: r.$id, reason: `Derived from forgotten memory #${seqOf(target)}.` }, { depth: depth + 1 }).catch((e) => {
        if (!(isEngramError(e) && e.code === "conflict")) throw e;
      });
    }
  } else {
    console.warn(`[engram] erasure cascade for ${target} stopped at depth ${depth}`);
  }
  // Recall logs keep the query and its results; a query that surfaced the memory may quote it. The collection
  // grows with every recall, so it is read a page at a time and only from the moment the memory existed: an
  // earlier recall cannot have returned it.
  const since = now?.metadata.createdAt ?? "";
  let cursor: string | undefined;
  for (;;) {
    const page = await b.vectors.query<RecallLogMeta>("recalls", {
      filters: [spaceF, ...(since ? [{ op: "gte" as const, path: "metadata.createdAt", value: since }] : [])],
      order: { field: "$id", dir: "asc" }, cursorAfter: cursor, limit: RECALL_PAGE, withVectors: false,
    });
    await Promise.all(page.filter((l) => l.metadata.returned.includes(target) && l.metadata.query !== REDACTED).map((l) =>
      b.vectors.update("recalls", l.$id, { embeddings: tombstoneVector(COLLECTION_DIMS.recalls), metadata: { ...l.metadata, query: REDACTED } })));
    if (page.length < RECALL_PAGE) break;
    cursor = page[page.length - 1].$id;
  }
  await scrubReasons(ctx, target);
}
const REDACTED = "[redacted: this recall returned a memory that was later forgotten]";

/**
 * Classifier reasons about a forgotten memory can quote it. They live on newer entries only (the entry that found
 * the relation, or the link entry recording it), so the scan starts just after the memory.
 */
async function scrubReasons(ctx: Ctx, target: string) {
  let cursor = target;
  for (;;) {
    const page = await ctx.b.vectors.query<EntryMeta>("memories", {
      filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }], order: { field: "$id", dir: "asc" }, cursorAfter: cursor, limit: 500, withVectors: false,
    });
    for (const d of page) {
      const notes = notesOf(d.metadata.d);
      const keys = Object.keys(notes);
      if (!keys.length) continue;
      const r = d.metadata.h.refs;
      // A link entry's reason is about its pair as a whole; a memory's reasons are keyed by the other memory.
      const pair = d.metadata.op === "link" && (r.target === target || r.related.includes(target));
      if (!pair && !(target in notes)) continue;
      await patchDerived(ctx.b, d.$id, (cur) => {
        const left = { ...notesOf(cur) };
        if (pair) for (const k of Object.keys(left)) delete left[k];
        else delete left[target];
        return { reasons: left };
      });
    }
    if (page.length < 500) return;
    cursor = page[page.length - 1].$id;
  }
}

export const LEGACY_REASON = "Recorded before reasons were stored.";

/**
 * Open conflicts as pairs for the inbox. Each pair carries the reason stored on the newer memory (by the
 * classifier, the background check or the demo script) and `via`, how it was decided; pairs recorded before reasons
 * were stored say so instead of inventing one.
 */
export async function listConflicts(ctx: Ctx) {
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.status", values: ["active"] }, { op: "eq", path: "metadata.conflict", values: ["true"] }],
    order: { field: "$id", dir: "desc" }, limit: 200, withVectors: false,
  });
  const byId = new Map(docs.map((d) => [d.$id, d]));
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  const seen = new Set<string>();
  const pairs = [];
  for (const d of docs) for (const p of d.metadata.d.contradictedBy) {
    const key = [d.$id, p].sort().join("|");
    const o = byId.get(p);
    if (seen.has(key) || !o) continue;
    seen.add(key);
    const [a, b] = d.$id < p ? [d, o] : [o, d];
    const card = (x: typeof d) => ({
      id: x.$id, seq: seqOf(x.$id), text: x.metadata.c.text, agent: x.metadata.agent, agentName: names[x.metadata.agent] ?? x.metadata.agent,
      createdAt: x.metadata.createdAt, source: x.metadata.h.source, subject: x.metadata.subject, importance: Number(x.metadata.h.importance),
    });
    const note: RelationNote | undefined = notesOf(b.metadata.d)[a.$id] ?? notesOf(a.metadata.d)[b.$id];
    pairs.push({ a: card(a), b: card(b), reason: note?.reason || LEGACY_REASON, via: note?.via ?? ("legacy" as const) });
  }
  return { pairs };
}

export interface ResolveResult { linkEntryId: string; seq: number; action: LinkKind; winner: string; loser: string }

/** A person or agent settles a conflict. The resolution itself becomes part of the chain. */
export async function resolveConflict(ctx: Ctx, raw: unknown): Promise<ResolveResult> {
  requireScope(ctx, "resolve");
  const input = ResolveInput.parse(raw);
  if (input.winnerId === input.loserId) throw new EngramError("bad_request", "Pick two different memories.");
  const [w, l] = await Promise.all([input.winnerId, input.loserId].map((id) => ctx.b.vectors.get<EntryMeta>("memories", id)));
  if (!w || !l || w.metadata.space !== ctx.space.key || l.metadata.space !== ctx.space.key) throw new EngramError("not_found", "One of the memories was not found in this space.");
  if (w.metadata.d.status !== "active" || l.metadata.d.status !== "active") throw new EngramError("conflict", "Both memories must still be active to resolve a conflict.");
  // Every action needs an open conflict between the two, supersede included: otherwise any key with the resolve
  // scope could retire any memory it names.
  if (!(w.metadata.d.contradictedBy ?? []).includes(l.$id) && !(l.metadata.d.contradictedBy ?? []).includes(w.$id)) {
    throw new EngramError("bad_request", "These memories are not in conflict. Only an open conflict can be resolved.");
  }
  const res = await linkFound(ctx, { target: l.$id, other: w.$id, kind: input.action, reason: input.reason, via: "resolution" });
  return { linkEntryId: res.id, seq: res.seq, action: input.action, winner: w.$id, loser: l.$id };
}

/**
 * Link entries are permanent, and their text can never be erased (only memories are forgotten), so it is a fixed
 * description of the kind. The free-text reason (a model's or a person's, which may quote either memory) goes into
 * the entry's derived reasons, which are scrubbed when either memory is forgotten.
 */
export const LINK_TEXT: Record<LinkKind, string> = {
  supersede: "Resolution: the related memory supersedes the target memory.",
  contradict: "Conflict found after the fact: the two memories disagree.",
  refine: "Resolution: both memories are true; one adds detail to the other.",
  dismiss: "Resolution: the two memories are not in conflict.",
};

/** Append a link entry about a pair: target and other (the winner for supersede). */
export async function linkFound(ctx: Ctx, args: { target: string; other: string; kind: LinkKind; reason: string; via?: RelationVia }) {
  const t = await ctx.b.vectors.get<EntryMeta>("memories", args.target);
  if (!t || t.metadata.space !== ctx.space.key || !args.other.startsWith(`m_${ctx.space.key}_`)) throw new EngramError("not_found", "One of the memories was not found in this space.");
  const relation = args.kind === "supersede" ? "supersedes" as const : args.kind === "contradict" ? "contradicts" as const : args.kind === "refine" ? "refines" as const : "unrelated" as const;
  return append(ctx, {
    op: "link",
    kind: args.kind,
    subject: t?.metadata.subject ?? null,
    text: LINK_TEXT[args.kind],
    refs: { target: args.target, related: [args.other], supersedes: args.kind === "supersede" ? [args.target] : [] },
    extra: args.reason ? { reasons: { [args.target]: { relation, reason: args.reason, via: args.via ?? "resolution" } } } : undefined,
  });
}
