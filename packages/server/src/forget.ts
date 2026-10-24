/** forget (provable erasure) and link entries (conflict resolution, late findings). */
import { seqOf, type EntryMeta, type LinkKind } from "@engram/core";
import { requireScope } from "./agents";
import { append, updateNeighbours } from "./chain";
import type { Ctx } from "./context";
import { EngramError } from "./errors";
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
  return { forgetEntryId: res.id, seq: res.seq, target: input.id, targetSeq: seqOf(input.id), status: "forgotten", erased };
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
  if (!(w.metadata.d.contradictedBy ?? []).includes(l.$id) && input.action !== "supersede") {
    throw new EngramError("bad_request", "These memories are not in conflict.");
  }
  const res = await linkFound(ctx, { target: l.$id, other: w.$id, kind: input.action, reason: input.reason });
  return { linkEntryId: res.id, seq: res.seq, action: input.action, winner: w.$id, loser: l.$id };
}

/** Append a link entry about a pair: target and other (the winner for supersede). */
export async function linkFound(ctx: Ctx, args: { target: string; other: string; kind: LinkKind; reason: string }) {
  const t = await ctx.b.vectors.get<EntryMeta>("memories", args.target);
  return append(ctx, {
    op: "link",
    kind: args.kind,
    subject: t?.metadata.subject ?? null,
    text: args.reason || null,
    refs: { target: args.target, related: [args.other], supersedes: args.kind === "supersede" ? [args.target] : [] },
  });
}
