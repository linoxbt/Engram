import "server-only";
import type { NextRequest } from "next/server";
import { EngramError } from "@engram/server";
import { clientKey, WindowCounter } from "./limits";

// Fixed-window counters per function instance. Serverless hosts run a handful of warm instances, so this
// is a speed bump against brute force and email bombing rather than an exact global quota. Password sign-in has
// its own shared, exact limits per account (packages/server/src/backend/login-guard.ts), and Appwrite's own
// per-project limits sit behind both.
const counter = new WindowCounter(50_000);

/**
 * The client's rate-limit key: its IPv4 address, its IPv6 /64, or "unknown". Netlify's own client-IP header first:
 * it cannot be set by the client, unlike X-Forwarded-For. Requests without a usable address share the one
 * "unknown" key, a single strict bucket, rather than going unlimited.
 */
export function clientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return clientKey(h.get("x-nf-client-connection-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").pop()?.trim());
}

/** Throws rate_limited once `key` has been seen `max` times in the current window for `bucket`. */
export function rateLimit(bucket: string, key: string, max: number, windowMs: number, message = "Too many attempts.") {
  const wait = counter.hit(`${bucket}:${key.toLowerCase()}`, max, windowMs);
  if (wait !== null) {
    const mins = Math.ceil(wait / 60_000);
    throw new EngramError("rate_limited", `${message} Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
