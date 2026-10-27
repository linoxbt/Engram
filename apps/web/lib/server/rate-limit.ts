import "server-only";
import type { NextRequest } from "next/server";
import { EngramError } from "@engram/server";
import { clientIpFrom, SPACE_WORK_LIMITS, WindowCounter } from "./limits";

// Fixed-window counters per function instance. Serverless hosts run a handful of warm instances, so this
// is a speed bump against brute force and email bombing rather than an exact global quota. Password sign-in has
// its own shared, exact limits per account (packages/server/src/backend/login-guard.ts), and Appwrite's own
// per-project limits sit behind both.
const counter = new WindowCounter(50_000);

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** The client's rate-limit key: its IPv4 address, its IPv6 /64, or "unknown". See `clientIpFrom`. */
export const clientIp = (req: NextRequest | Request): string => clientIpFrom(req.headers, process.env.NODE_ENV === "production");

/** The budget above, keyed on the person AND the space (as /export and /verify already are). */
export function limitSpaceWork(kind: keyof typeof SPACE_WORK_LIMITS, userId: string, spaceKey: string) {
  const l = SPACE_WORK_LIMITS[kind];
  rateLimit(`space-${kind}`, `${userId}:${spaceKey}`, l.max, HOUR, l.message);
}

/** Throws rate_limited once `key` has been seen `max` times in the current window for `bucket`. */
export function rateLimit(bucket: string, key: string, max: number, windowMs: number, message = "Too many attempts.") {
  const wait = counter.hit(`${bucket}:${key.toLowerCase()}`, max, windowMs);
  if (wait !== null) {
    const mins = Math.ceil(wait / 60_000);
    throw new EngramError("rate_limited", `${message} Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}
