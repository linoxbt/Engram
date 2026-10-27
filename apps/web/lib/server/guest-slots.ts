/**
 * Admission to the live demo. Every guest that gets in is a real Appwrite account plus a team membership and a
 * `gu_` marker file, and the clean-up only removes 10 of them per later visit, so a burst stays for a day. The
 * in-process counter the route used before was per lambda instance and per IP: a handful of warm instances
 * multiplied the quota, and a cold one started it over.
 *
 * So the per-network quota uses the same create-first slot reservation as password sign-in (login-guard.ts):
 * a numbered file ID the storage refuses to create twice, which every instance shares and no read-then-write
 * can race. On top of it sits a hard ceiling on live guests, counted from the markers themselves.
 */
import { createHash } from "node:crypto";
import { EngramError, getConfig, reserveSlot, type AttemptStore, type Backend } from "@engram/server";

/** Guests one network may start per hour, across every server instance. */
export const GUEST_ENTER_LIMIT = { max: 5, windowMs: 60 * 60_000 };
/** Live guest accounts allowed at once. Reached only by a burst; it drains as the 24-hour clean-up catches up. */
export const MAX_LIVE_GUESTS = 300;
/** Expired reservations swept per visit, so the slot files do not pile up the way guests would. */
const SWEEP_BATCH = 20;

/** File IDs: at most 36 characters of [a-zA-Z0-9._-], starting with a letter or digit. */
const SLOT_PREFIX = "dg";
const digest = (s: string) => createHash("sha256").update("engram:demo:v1:" + s).digest("hex").slice(0, 12);
const windowOf = (now: number) => Math.floor(now / GUEST_ENTER_LIMIT.windowMs);
const storeOf = (b: Backend): AttemptStore => ({ files: b.files, bucket: getConfig().appwrite.checkpointsBucket });

/**
 * Let one more guest in, or refuse. Throws `rate_limited` when this network has had its share of the hour, or
 * when the demo is already holding as many guests as it will.
 */
export async function admitGuest(b: Backend, client: string, now = Date.now()): Promise<void> {
  const store = storeOf(b);
  const live = await store.files.list(store.bucket, "gu_");
  if (live.length >= MAX_LIVE_GUESTS) {
    throw new EngramError("rate_limited", "The live demo is full right now. Try again in an hour, or create a free account.");
  }
  const prefix = `${SLOT_PREFIX}${digest(client)}_${windowOf(now).toString(36)}_`;
  if (!(await reserveSlot(store, prefix, GUEST_ENTER_LIMIT.max))) {
    const mins = Math.max(1, Math.ceil(((windowOf(now) + 1) * GUEST_ENTER_LIMIT.windowMs - now) / 60_000));
    throw new EngramError("rate_limited", `Too many demo visits from this network. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}

/** Drop reservations whose window has passed. Best effort, in the background, a bounded batch at a time. */
export async function sweepGuestSlots(b: Backend, now = Date.now()): Promise<number> {
  const store = storeOf(b);
  const stale = new Date(now - GUEST_ENTER_LIMIT.windowMs).toISOString();
  const doomed = (await store.files.list(store.bucket, SLOT_PREFIX)).filter((f) => f.createdAt < stale).slice(0, SWEEP_BATCH);
  for (const f of doomed) await store.files.delete(store.bucket, f.fileId).catch(() => undefined);
  return doomed.length;
}
