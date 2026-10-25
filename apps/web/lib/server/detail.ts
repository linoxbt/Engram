import "server-only";
import { seqOf, type EntryMeta } from "@engram/core";
import { agentNames, EngramError, notesOf, type Ctx } from "@engram/server";

/** One entry with everything the caller may see, plus its neighbours resolved for display. */
export async function memoryDetail(ctx: Ctx, id: string) {
  const doc = await ctx.b.vectors.get<EntryMeta>("memories", id);
  if (!doc || doc.metadata.space !== ctx.space.key) throw new EngramError("not_found", "Memory not found.");
  const m = doc.metadata;
  const relIds = [...new Set([...m.h.refs.supersedes, ...m.h.refs.contradicts, ...m.h.refs.related, ...m.h.refs.derivedFrom, ...(m.h.refs.target ? [m.h.refs.target] : []),
    ...(m.d.supersededBy ? [m.d.supersededBy] : []), ...m.d.contradictedBy, ...(m.d.forgottenBy ? [m.d.forgottenBy] : [])])];
  const rel = (await Promise.all(relIds.map((r) => ctx.b.vectors.get<EntryMeta>("memories", r)))).filter((d): d is NonNullable<typeof d> => !!d);
  const names = await agentNames(ctx.b, [m.agent, ...rel.map((r) => r.metadata.agent)], ctx.space);
  const cp = ctx.space.settings.latestCheckpoint;
  const seq = seqOf(id);
  return {
    id, seq,
    op: m.op, kind: m.kind, subject: m.subject, text: m.c.text, status: m.d.status, conflict: m.conflict === "true",
    agent: m.agent, agentName: names[m.agent] ?? m.agent,
    createdAt: m.createdAt, validFrom: m.h.validFrom, validTo: m.d.validTo, forgottenAt: m.d.forgottenAt, forgottenBy: m.d.forgottenBy,
    importance: Number(m.h.importance), confidence: Number(m.h.confidence), source: m.h.source, model: m.h.model,
    hash: m.hash, prevHash: m.h.prevHash, contentHash: m.h.contentHash, embHash: m.h.embHash, concept: m.d.concept,
    access: Number(m.d.access), lastAccessAt: m.d.lastAccessAt, relateStatus: m.d.relateStatus,
    header: m.h,
    refs: m.h.refs,
    supersededBy: m.d.supersededBy,
    contradictedBy: m.d.contradictedBy,
    // Why each relation was recorded (classifier, script or resolver), keyed by the other memory. Erasable: link
    // entries carry fixed text, so this is where a resolver's own words live.
    reasons: notesOf(m.d),
    related: rel.map((r) => ({ id: r.$id, seq: seqOf(r.$id), op: r.metadata.op, kind: r.metadata.kind, text: r.metadata.c.text, status: r.metadata.d.status, agentName: names[r.metadata.agent] ?? r.metadata.agent, createdAt: r.metadata.createdAt })),
    checkpoint: cp && seq < cp.size ? cp : null,
  };
}
