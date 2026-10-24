/** As-of semantics: was memory m valid at time T? */
import { isMemoryOp } from "./metadata";
import { replay } from "./replay";
import type { EntryMeta, Header } from "./types";

/** Fast path from derived fields. */
export function validAt(m: Pick<EntryMeta, "createdAt" | "validTo" | "forgottenAt" | "op">, t: string): boolean {
  if (!isMemoryOp(m.op)) return false;
  if (m.createdAt > t) return false;
  if (m.validTo && m.validTo <= t) return false;
  if (m.forgottenAt && m.forgottenAt <= t) return false;
  return true;
}

/** Authoritative mode: replay the chain up to T and return the IDs valid at T. */
export function validSetAt(entries: { id: string; h: Header }[], t: string): Set<string> {
  const state = replay(entries, t);
  const out = new Set<string>();
  for (const [id, s] of state) if (s.status === "active") out.add(id);
  return out;
}
