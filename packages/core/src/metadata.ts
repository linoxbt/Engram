import { count8 } from "./encode";
import type { Content, Derived, EntryMeta, Header, Op, Status } from "./types";

export const isMemoryOp = (op: Op) => op === "remember" || op === "reflect";

export function initialDerived(op: Op): Derived {
  return {
    status: isMemoryOp(op) ? "active" : "recorded",
    validTo: null,
    supersededBy: null,
    contradictedBy: [],
    forgottenAt: null,
    forgottenBy: null,
    concept: null,
    access: count8(0),
    lastAccessAt: null,
    relateStatus: "done",
  };
}

/** Build the full metadata object; top-level copies always come from h, c and d. */
export function buildMeta(args: { h: Header; hash: string; c: Content; d: Derived; idem?: string | null; sig?: string | null; applied?: "true" | "false" }): EntryMeta {
  const { h, hash, c, d } = args;
  return {
    space: h.space,
    seq: h.seq,
    h,
    hash,
    sig: args.sig ?? null,
    c,
    d,
    op: h.op,
    kind: h.kind,
    subject: h.subject,
    agent: h.agent,
    createdAt: h.createdAt,
    status: d.status,
    validTo: d.validTo,
    forgottenAt: d.forgottenAt,
    conflict: d.contradictedBy.length ? "true" : "false",
    text: c.text,
    idem: args.idem ?? null,
    applied: args.applied ?? "true",
  };
}

/** Patch derived (and optionally content) fields and keep the top-level copies in step. */
export function patchMeta(meta: EntryMeta, d: Partial<Derived>, c?: Content): EntryMeta {
  return buildMeta({ h: meta.h, hash: meta.hash, sig: meta.sig, idem: meta.idem, applied: meta.applied, c: c ?? meta.c, d: { ...meta.d, ...d } });
}

export const isLive = (s: Status) => s === "active";
