/**
 * Derived state from the chain. One reducer is shared by the write path (to
 * compute neighbour updates) and the verifier (to recompute everything), so
 * the two can never disagree.
 */
import { isMemoryOp } from "./metadata";
import type { Header, Status } from "./types";

export interface DerivedState {
  status: Status;
  validTo: string | null;
  supersededBy: string | null;
  contradictedBy: string[];
  forgottenAt: string | null;
  forgottenBy: string | null;
}

export type StateMap = Map<string, DerivedState>;

const fresh = (status: Status): DerivedState => ({
  status, validTo: null, supersededBy: null, contradictedBy: [], forgottenAt: null, forgottenBy: null,
});

export const cloneState = (s: DerivedState): DerivedState => ({ ...s, contradictedBy: [...s.contradictedBy] });

/**
 * Apply one entry. Returns the IDs whose state changed (including the new
 * entry). Missing referenced IDs are ignored here; the verifier reports them
 * through the refs rule.
 */
export function applyEntry(state: StateMap, id: string, h: Header): Set<string> {
  const changed = new Set<string>([id]);
  const touch = (x: string) => changed.add(x);

  const dropConflicts = (t: string) => {
    const st = state.get(t);
    if (!st) return;
    for (const p of st.contradictedBy) {
      const ps = state.get(p);
      if (ps) { ps.contradictedBy = ps.contradictedBy.filter((x) => x !== t); touch(p); }
    }
    st.contradictedBy = [];
  };
  const retire = (t: string, by: string, at: string) => {
    const st = state.get(t);
    if (!st || st.status !== "active") return;
    dropConflicts(t);
    st.status = "superseded";
    st.validTo = at;
    st.supersededBy = by;
    touch(t);
  };
  const unlinkPair = (a: string, b: string) => {
    const sa = state.get(a), sb = state.get(b);
    if (sa) { sa.contradictedBy = sa.contradictedBy.filter((x) => x !== b); touch(a); }
    if (sb) { sb.contradictedBy = sb.contradictedBy.filter((x) => x !== a); touch(b); }
  };

  if (isMemoryOp(h.op)) {
    const me = fresh("active");
    state.set(id, me);
    for (const t of h.refs.supersedes) retire(t, id, h.createdAt);
    for (const c of h.refs.contradicts) {
      const cs = state.get(c);
      if (!cs || cs.status !== "active" || c === id) continue;
      if (!me.contradictedBy.includes(c)) me.contradictedBy.push(c);
      if (!cs.contradictedBy.includes(id)) cs.contradictedBy.push(id);
      touch(c);
    }
  } else if (h.op === "forget") {
    state.set(id, fresh("recorded"));
    const t = h.refs.target;
    const st = t ? state.get(t) : undefined;
    if (t && st && st.status !== "forgotten") {
      dropConflicts(t);
      st.status = "forgotten";
      st.forgottenAt = h.createdAt;
      st.forgottenBy = id;
      touch(t);
    }
  } else if (h.op === "link") {
    state.set(id, fresh("recorded"));
    const t = h.refs.target;
    const w = h.refs.related[0] ?? null;
    if (t) {
      if (h.kind === "supersede" && h.refs.supersedes.includes(t)) retire(t, w ?? id, h.createdAt);
      else if (w) unlinkPair(t, w);
    }
  }
  return changed;
}

/** Replay a chain (in order). With `until`, only entries created at or before it count. */
export function replay(entries: { id: string; h: Header }[], until?: string): StateMap {
  const state: StateMap = new Map();
  for (const e of entries) {
    if (until && e.h.createdAt > until) break;
    applyEntry(state, e.id, e.h);
  }
  return state;
}

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
