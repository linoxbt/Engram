/**
 * When the labeler should spend a model call on a concept. A new concept already carries a rule-based label, and
 * the app relabels inline when a concept reaches 3, 10, 30 and 100 members; the event-driven labeler is the
 * catch-up for a relabel the app missed (an instance that died before its deferred work ran).
 */
export const LABEL_AT = [3, 10, 30, 100];

export interface ConceptCounts { members?: unknown; membersN?: unknown; labeledAtMembers?: unknown }

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);

/** The highest threshold the concept has reached but has not been labelled at, or null when nothing is due. */
export function labelDue(meta: ConceptCounts | null | undefined): number | null {
  if (!meta) return null;
  const members = Number.isFinite(num(meta.membersN)) ? num(meta.membersN) : num(meta.members);
  const labeledAt = Number.isFinite(num(meta.labeledAtMembers)) ? num(meta.labeledAtMembers) : 0;
  if (!Number.isFinite(members)) return null;
  const due = LABEL_AT.filter((t) => members >= t && labeledAt < t);
  return due.length ? due[due.length - 1] : null;
}
