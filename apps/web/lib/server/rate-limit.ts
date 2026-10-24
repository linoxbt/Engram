import "server-only";
import type { NextRequest } from "next/server";
import { EngramError } from "@engram/server";

// Fixed-window counters per function instance. Serverless hosts run a handful of warm instances, so this
// is a speed bump against brute force and email bombing rather than an exact global quota; Appwrite's
// own per-project limits sit behind it.
const windows = new Map<string, { count: number; resetAt: number }>();
let sweptAt = 0;

export function clientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

/** Throws rate_limited once `key` has been seen `max` times in the current window for `bucket`. */
export function rateLimit(bucket: string, key: string, max: number, windowMs: number, message = "Too many attempts.") {
  const now = Date.now();
  if (now - sweptAt > 60_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    sweptAt = now;
  }
  const id = `${bucket}:${key.toLowerCase()}`;
  const w = windows.get(id);
  if (!w || w.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (++w.count > max) {
    const wait = Math.ceil((w.resetAt - now) / 60_000);
    throw new EngramError("rate_limited", `${message} Try again in ${wait} minute${wait === 1 ? "" : "s"}.`);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
