import "server-only";
import type { NextRequest } from "next/server";
import { EngramError } from "@engram/server";

// Fixed-window counters per function instance. Serverless hosts run a handful of warm instances, so this
// is a speed bump against brute force and email bombing rather than an exact global quota; Appwrite's
// own per-project limits sit behind it.
const windows = new Map<string, { count: number; resetAt: number }>();
let sweptAt = 0;

const MAX_KEYS = 50_000;

/** Netlify's own client-IP header first: it cannot be set by the client, unlike X-Forwarded-For. */
export function clientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return h.get("x-nf-client-connection-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
}

/** Throws rate_limited once `key` has been seen `max` times in the current window for `bucket`. */
export function rateLimit(bucket: string, key: string, max: number, windowMs: number, message = "Too many attempts.") {
  const now = Date.now();
  if (now - sweptAt > 60_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    sweptAt = now;
  }
  // Requests without a known address would otherwise all share one counter and lock each other out.
  if (key === "unknown") return;
  if (windows.size > MAX_KEYS) windows.clear();
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
