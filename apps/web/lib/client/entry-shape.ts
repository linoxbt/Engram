/**
 * The chain endpoint hands a member full entries and a viewer (the demo guest) headers and hashes only, so
 * every page that draws the chain has to read both shapes. `metadata` is what tells them apart: a viewer's
 * entry has none, and asking it for `metadata.seq` is how a read-only visitor gets a blank page instead of a
 * chain. Status and text are genuinely absent for a viewer, not merely hidden, so they come back undefined.
 */
import type { ChainEntry, PublicEntry } from "@engram/core";

export type AnyEntry = ChainEntry | PublicEntry;

const full = (e: AnyEntry): e is ChainEntry => typeof (e as ChainEntry).metadata === "object" && (e as ChainEntry).metadata !== null;

export interface EntryBlock { seq: number; op: string; status?: string; hash: string; text?: string | null }

export function entryBlock(e: AnyEntry): EntryBlock {
  if (full(e)) return { seq: Number(e.metadata.seq), op: e.metadata.op, status: e.metadata.d?.status, hash: e.metadata.hash, text: e.metadata.c?.text };
  return { seq: Number(e.h.seq), op: e.h.op, hash: e.hash };
}

/** The text of an entry, or "" when the caller is not allowed to see it. */
export const entryText = (e: AnyEntry): string => (full(e) ? (e.metadata.c?.text ?? "") : "");
