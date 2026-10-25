/** forget (provable erasure) and link entries (conflict resolution, late findings). */
import { seqOf, tombstoneVector, type EntryMeta, type LinkKind } from "@engram/core";
import { requireScope } from "./agents";
import { append, updateNeighbours } from "./chain";
import { scrubConcept } from "./concepts";
import { COLLECTION_DIMS, type Ctx } from "./context";
import { EngramError, isEngramError } from "./errors";
import { ForgetInput, ResolveInput } from "./schemas";

export interface ForgetResult { forgetEntryId: string; seq: number; target: string; targetSeq: number; status: "forgotten"; erased: boolean }

/**
 * Append a forget entry, then erase the target's text, salt and vector. The
 * target's header and hash stay untouched, so the chain still verifies: the
 * header covers the salted content hash, never the text.
 */
export async function forget(ctx: Ctx, raw: unknown, opts: { createdAt?: string } = {}): Promise<ForgetResult> {
  requireScope(ctx, "forget");
  const input = ForgetInput.parse(raw);
  const target = await ctx.b.vectors.get<EntryMeta>("memories", input.id);
  if (!target || target.metadata.space !== ctx.space.key) throw new EngramError("not_found", `Memory ${input.id} not found in this space.`);
  const m = target.metadata;
  if (m.op !== "remember" && m.op !== "reflect") throw new EngramError("bad_request", "Only memories can be forgotten, not forget or link entries.");
  if (m.d.status === "forgotten") throw new EngramError("conflict", `Memory #${seqOf(input.id)} was already forgotten by ${m.d.forgottenBy}.`);

  const res = await append(ctx, {
    op: "forget",
    kind: "tombstone",
    subject: m.subject,
    text: input.reason || null,
    refs: { target: input.id },
    createdAt: opts.createdAt,
  });
  let erased = !res.derivedPending;
  if (!erased) {
    // Erasure is a promise: keep trying in the background until it lands.
    erased = await updateNeighbours(ctx, res.id, res.meta.h, 8);
    if (!erased) ctx.defer(() => updateNeighbours(ctx, res.id, res.meta.h, 20));
  }
  // Text also lives on in places built from it: concept labels, reflect summaries and recall logs.
  await eraseCopies(ctx, input.id, m.d.concept ?? null).catch((e) => {
    console.error("[engram] erasing copies failed; retrying in the background", e);
    ctx.defer(() => eraseCopies(ctx, input.id, m.d.concept ?? null));
  });
  return { forgetEntryId: res.id, seq: res.seq, target: input.id, targetSeq: seqOf(input.id), status: "forgotten", erased };
}

export async function eraseCopies(ctx: Ctx, target: string, concept: string | null) {
  const { b, space } = ctx;
  if (concept) await scrubConcept(ctx, concept, target);
  // Summaries derived from the memory restate it, so they are forgotten too (and cascade in turn).
  const reflections = await b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [space.key] }, { op: "eq", path: "metadata.op", values: ["reflect"] }],
    limit: 500, withVectors: false,
  });
  for (const r of reflections) {
    if (r.metadata.d.status === "forgotten" || !r.metadata.h.refs.derivedFrom.includes(target)) continue;
    await forget(ctx, { id: r.$id, reason: `Derived from forgotten memory #${seqOf(target)}.` }).catch((e) => {
      if (!(isEngramError(e) && e.code === "conflict")) throw e;
    });
  }
  // Recall logs keep the query and its results; a query that surfaced the memory may quote it.
  const logs = await b.vectors.query<{ returned: string[]; query: string }>("recalls", {
    filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], order: { field: "$id", dir: "desc" }, limit: 1000, withVectors: false,
  });
  await Promise.all(logs.filter((l) => l.metadata.returned.includes(target) && l.metadata.query !== REDACTED).map((l) =>
    b.vectors.update("recalls", l.$id, { embeddings: tombstoneVector(COLLECTION_DIMS.recalls), metadata: { ...l.metadata, query: REDACTED } })));
}
const REDACTED = "[redacted: this recall returned a memory that was later forgotten]";

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
  const res = await linkFound(ctx, { target: l.$id, other: w.$id, kind: input.action, reason: input.reason });
  return { linkEntryId: res.id, seq: res.seq, action: input.action, winner: w.$id, loser: l.$id };
}

/** Append a link entry about a pair: target and other (the winner for supersede). */
export async function linkFound(ctx: Ctx, args: { target: string; other: string; kind: LinkKind; reason: string }) {
  const t = await ctx.b.vectors.get<EntryMeta>("memories", args.target);
  if (!t || t.metadata.space !== ctx.space.key || !args.other.startsWith(`m_${ctx.space.key}_`)) throw new EngramError("not_found", "One of the memories was not found in this space.");
  return append(ctx, {
    op: "link",
    kind: args.kind,
    subject: t?.metadata.subject ?? null,
    text: args.reason || null,
    refs: { target: args.target, related: [args.other], supersedes: args.kind === "supersede" ? [args.target] : [] },
  });
}
