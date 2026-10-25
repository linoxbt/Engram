/** Query-string parameters of the list routes: malformed values are a 400, never a 500 from the database. */
import { z } from "zod";
import type { Backend, Collection } from "./backend/types";
import { EngramError } from "./errors";

const WholeNumber = z.string().trim().regex(/^\d{1,9}$/);

/** `limit`: a whole number, clamped to [1, max]; absent means `def`. */
export function parseLimit(raw: string | null | undefined, def: number, max: number): number {
  if (raw == null || raw === "") return Math.min(def, max);
  const r = WholeNumber.safeParse(raw);
  if (!r.success) throw new EngramError("bad_request", `limit: must be a whole number from 1 to ${max}.`);
  return Math.min(max, Math.max(1, Number(r.data)));
}

/** A non-negative whole number (an entry sequence number such as `after`); absent means undefined. */
export function parseSeqParam(name: string, raw: string | null | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const r = WholeNumber.safeParse(raw);
  if (!r.success) throw new EngramError("bad_request", `${name}: must be a whole number.`);
  return Number(r.data);
}

/**
 * `cursor` for chain and memory pages: an entry ID of this space that exists. An unknown cursor would make
 * Appwrite fail (a 500) and the local backend silently restart from the first page.
 */
export async function parseEntryCursor(b: Backend, spaceKey: string, raw: string | null | undefined, coll: Collection = "memories"): Promise<string | undefined> {
  if (raw == null || raw === "") return undefined;
  const id = raw.trim();
  if (!new RegExp(`^m_${spaceKey}_\\d{12}$`).test(id)) throw new EngramError("bad_request", "cursor: not an entry ID of this space.");
  if (!(await b.vectors.get(coll, id))) throw new EngramError("bad_request", "cursor: unknown entry. Start again without a cursor.");
  return id;
}
