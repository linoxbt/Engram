/**
 * Sign-in attempt limits that every server instance shares. The server signs in with the API key, which bypasses
 * Appwrite's own per-IP limits, so without this a password could be guessed at the speed of the network.
 *
 * Each attempt first RESERVES a numbered slot, created with a unique file ID (`<prefix><nn>`): the storage refuses a
 * duplicate ID, so parallel guesses race for distinct slots and can never exceed the limit (no read-then-write).
 * Only then is the password checked. A success, or an error that is not a wrong password, gives its slots back.
 *
 * Two limits apply together:
 * - per account AND client (the IP, or its /64 for IPv6): 8 attempts per 15 minutes. Someone guessing from their
 *   own network locks only themselves out, not the account's owner signing in from elsewhere;
 * - per account from anywhere: 50 attempts per hour, so guessing spread across many addresses stays capped.
 * The work is the same whether or not the address has an account (no user lookup), so neither the answer nor its
 * timing tells an attacker which accounts exist. Passkey sign-in and password reset do not go through here, so
 * they keep working while password sign-in is locked.
 */
import { createHash } from "node:crypto";
import { EngramError, isConflict, isEngramError } from "../errors";
import type { FileStore } from "./types";

export const LOGIN_LIMITS = {
  client: { max: 8, windowMs: 15 * 60_000 },
  account: { max: 50, windowMs: 60 * 60_000 },
} as const;

export interface AttemptStore { files: FileStore; bucket: string }

const BODY = new TextEncoder().encode("{}");
const digest = (s: string, n: number) => createHash("sha256").update("engram:login:v1:" + s).digest("hex").slice(0, n);
const windowOf = (now: number, ms: number) => Math.floor(now / ms);
const normEmail = (email: string) => email.trim().toLowerCase();

/** File ID prefixes (Appwrite IDs: at most 36 characters, [a-zA-Z0-9._-], starting with a letter or digit). */
export function loginKeys(email: string, client: string | undefined, now = Date.now()) {
  const account = "l" + digest(normEmail(email), 12);
  const clientTag = account + "c" + digest(client || "-", 8);
  return {
    /** Every slot of this account, any client, any window. */
    account,
    /** This client's slots for this account, any window. */
    client: clientTag + "_",
    clientWindow: `${clientTag}_${windowOf(now, LOGIN_LIMITS.client.windowMs).toString(36)}_`,
    accountWindow: `${account}g_${windowOf(now, LOGIN_LIMITS.account.windowMs).toString(36)}_`,
  };
}

/**
 * Claim the lowest free numbered slot under `prefix`, or null when all `max` are taken. Create-first, so it is an
 * exact limit every server instance shares (also used for demo guest admission in apps/web).
 */
export async function reserveSlot(store: AttemptStore, prefix: string, max: number): Promise<string | null> {
  const taken = new Set((await store.files.list(store.bucket, prefix)).map((f) => f.fileId));
  for (let n = 0; n < max; n++) {
    const id = prefix + String(n).padStart(2, "0");
    if (taken.has(id)) continue;
    try {
      await store.files.put(store.bucket, id, `${id}.json`, BODY, []);
      return id;
    } catch (e) {
      if (!isConflict(e)) throw e; // someone else took it this instant: try the next one
    }
  }
  return null;
}

const release = (store: AttemptStore, ids: (string | null)[]) =>
  Promise.all(ids.filter((x): x is string => !!x).map((id) => store.files.delete(store.bucket, id).catch(() => undefined)));

function locked(windowMs: number, now: number): EngramError {
  const mins = Math.max(1, Math.ceil(((windowOf(now, windowMs) + 1) * windowMs - now) / 60_000));
  return new EngramError("rate_limited", `Too many failed sign-ins for this account. Try again in ${mins} minute${mins === 1 ? "" : "s"}, sign in with a passkey, or reset your password.`);
}

/** Wrong email or password: the only outcome that keeps its slot. */
const isWrongPassword = (e: unknown) => isEngramError(e) && e.code === "unauthorized";

/**
 * Run one password check under the limits. `attempt` must throw `unauthorized` for a wrong email or password; any
 * other error (an outage) does not count against the account.
 */
export async function guardedSignIn<T>(store: AttemptStore, email: string, client: string | undefined, attempt: () => Promise<T>, now = Date.now()): Promise<T> {
  const k = loginKeys(email, client, now);
  const mine = await reserveSlot(store, k.clientWindow, LOGIN_LIMITS.client.max);
  if (!mine) throw locked(LOGIN_LIMITS.client.windowMs, now);
  const shared = await reserveSlot(store, k.accountWindow, LOGIN_LIMITS.account.max);
  if (!shared) {
    await release(store, [mine]);
    throw locked(LOGIN_LIMITS.account.windowMs, now);
  }
  let result: T;
  try {
    result = await attempt();
  } catch (e) {
    if (!isWrongPassword(e)) await release(store, [mine, shared]);
    throw e;
  }
  // Proven: this client's earlier failures go, as do stale slots of the account. Best effort.
  await release(store, [mine, shared]);
  await clearAttempts(store, email, { client }).catch(() => undefined);
  return result;
}

/**
 * Remove recorded attempts: with `client`, that client's (any window) plus every expired slot of the account;
 * without, all of the account's (a completed password reset proves ownership of the address).
 */
export async function clearAttempts(store: AttemptStore, email: string, opts: { client?: string | undefined; all?: boolean } = {}, now = Date.now()) {
  const k = loginKeys(email, opts.client, now);
  const files = await store.files.list(store.bucket, k.account);
  const stale = now - LOGIN_LIMITS.account.windowMs;
  const doomed = files.filter((f) => opts.all || f.name.startsWith(k.client) || Date.parse(f.createdAt) < stale);
  await release(store, doomed.slice(0, 200).map((f) => f.fileId));
}
