/**
 * Per-account sign-in lockout, kept with the account so every server instance sees it. The server signs in with
 * the API key, which bypasses Appwrite's own per-IP limits, so without this a password could be guessed at the
 * speed of the network spread across instances.
 */
import { EngramError } from "../errors";

export interface LoginFails { fails: number; first: string; lockedUntil: string | null }

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;

export function assertNotLocked(f: LoginFails | null | undefined, now = Date.now()) {
  const until = f?.lockedUntil ? Date.parse(f.lockedUntil) : 0;
  if (until > now) {
    const mins = Math.ceil((until - now) / 60_000);
    throw new EngramError("rate_limited", `Too many failed sign-ins for this account. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or reset your password.`);
  }
}

export function afterFailure(f: LoginFails | null | undefined, now = Date.now()): LoginFails {
  const fresh = !f || now - Date.parse(f.first) > WINDOW_MS || (f.lockedUntil && Date.parse(f.lockedUntil) <= now);
  const next: LoginFails = fresh ? { fails: 1, first: new Date(now).toISOString(), lockedUntil: null } : { ...f!, fails: f!.fails + 1 };
  if (next.fails >= MAX_FAILS) next.lockedUntil = new Date(now + LOCK_MS).toISOString();
  return next;
}
