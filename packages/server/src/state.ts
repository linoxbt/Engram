/**
 * Space state store: the server-owned fields `integrity`, `seeding` and `invites`, with compare-and-swap writes.
 *
 * Team prefs are one object with no conditional write, so two processes patching different fields could each
 * write back the other's stale copy. Here every state change is a new immutable Storage file
 * `st_<space>_<n12>`, created with a fixed ID: Appwrite refuses a duplicate file ID with 409 (the same create-first
 * lock entry IDs use), so of two writers that read version n only one creates n+1; the other re-reads and
 * re-applies its change. Nothing is ever updated in place.
 *
 * Finding the latest version without listing: each process remembers the last version it saw (a hint) and probes
 * hint+1. `st_<space>_000000000000` is a marker written before version 1 and never pruned, so "no marker" proves
 * the store is empty (the space still uses the values it had in team prefs: lazy migration). Old versions are
 * pruned from the bottom, oldest first, stopping at the first failure, so the files that exist are always the
 * marker plus one contiguous run [lo, hi]. Hence "n+1 is missing, then n is present" proves n is the latest
 * (a pruner deletes n before n+1). A version is pruned only once at least KEEP newer versions exist and the
 * newest is PRUNE_AGE_MS younger than it (both Appwrite timestamps from one listing, so no clock skew); a writer
 * that read n as the latest within the last WRITE_WINDOW_MS therefore can never find n+1 freed by pruning.
 */
import type { Backend } from "./backend/types";
import { getConfig } from "./config";
import { EngramError, isConflict } from "./errors";
import type { IntegrityStatus, SeedProgress, SpaceInvite } from "./settings";

export const STATE_KEYS = ["integrity", "seeding", "invites"] as const;
export type StateKey = (typeof STATE_KEYS)[number];
export interface SpaceState { integrity: IntegrityStatus | null; seeding: SeedProgress | null; invites: SpaceInvite[] }

const KEEP = 10;
const PRUNE_EVERY = 10;
const PRUNE_AGE_MS = 10 * 60_000;
const WRITE_WINDOW_MS = 2 * 60_000;
/** Probing more than this many versions ahead of a stale hint costs more than one listing. */
const MAX_PROBES = 4;

const pad = (n: number) => String(n).padStart(12, "0");
export const statePrefix = (key: string) => `st_${key}_`;
export const stateFileId = (key: string, n: number) => `${statePrefix(key)}${pad(n)}`;
const enc = new TextEncoder();
const dec = new TextDecoder();
const bucket = () => getConfig().appwrite.checkpointsBucket;

export const emptyState = (): SpaceState => ({ integrity: null, seeding: null, invites: [] });
export function stateFrom(src: Partial<Record<StateKey, unknown>> | null | undefined): SpaceState {
  return {
    integrity: (src?.integrity as IntegrityStatus | null | undefined) ?? null,
    seeding: (src?.seeding as SeedProgress | null | undefined) ?? null,
    invites: Array.isArray(src?.invites) ? (src!.invites as SpaceInvite[]) : [],
  };
}
export const isStateKey = (k: string): k is StateKey => (STATE_KEYS as readonly string[]).includes(k);

/** Last version seen, per backend instance ("process") and space. 0 = the store was empty. */
const hints = new WeakMap<object, Map<string, number>>();
const hintsOf = (b: Backend) => { let m = hints.get(b); if (!m) hints.set(b, (m = new Map())); return m; };

async function getVersion(b: Backend, key: string, n: number): Promise<SpaceState | null> {
  const raw = await b.files.get(bucket(), stateFileId(key, n));
  if (!raw) return null;
  try { return stateFrom((JSON.parse(dec.decode(raw)) as { state?: Partial<SpaceState> }).state); }
  catch { throw new EngramError("internal", `Space state ${stateFileId(key, n)} is unreadable.`); }
}

async function listVersions(b: Backend, key: string) {
  const prefix = statePrefix(key);
  const files = await b.files.list(bucket(), prefix);
  return files
    .map((f) => ({ n: Number(f.name.slice(prefix.length, prefix.length + 12)), fileId: f.fileId, createdAt: f.createdAt }))
    .filter((f) => Number.isInteger(f.n) && f.n > 0)
    .sort((a, b) => a.n - b.n);
}

async function discover(b: Backend, key: string): Promise<number> {
  const v = await listVersions(b, key);
  return v.length ? v[v.length - 1].n : 0;
}

/**
 * The latest version. `strict` (writers) fetches n+1 strictly before n, which is what the contiguity proof needs;
 * readers fetch both at once, accepting a stale answer in the rare race with a pruner.
 */
async function readLatest(b: Backend, key: string, strict: boolean): Promise<{ n: number; state: SpaceState | null }> {
  const h = hintsOf(b);
  let n = h.get(key) ?? -1;
  let probes = 0;
  for (let guard = 0; guard < 8; ) {
    if (n <= 0) {
      if (!(await b.files.get(bucket(), stateFileId(key, 0)))) { h.set(key, 0); return { n: 0, state: null }; }
      n = await discover(b, key);
      guard++;
      if (n === 0) return { n: 0, state: null }; // marker written, version 1 not yet
    }
    let next: SpaceState | null, cur: SpaceState | null;
    if (strict) {
      next = await getVersion(b, key, n + 1);
      cur = next ? null : await getVersion(b, key, n);
    } else {
      [next, cur] = await Promise.all([getVersion(b, key, n + 1), getVersion(b, key, n)]);
    }
    if (next) {
      n += 1;
      if (++probes > MAX_PROBES) { n = await discover(b, key); probes = 0; guard++; }
      continue;
    }
    if (cur) { h.set(key, n); return { n, state: cur }; }
    // Our hint fell below the oldest kept version (or the space was purged): ask Storage.
    n = await discover(b, key);
    guard++;
    if (n === 0) {
      // Listing found no version although the marker may exist: re-check from the marker.
      n = -1;
    }
  }
  throw new EngramError("unavailable", "Could not read this space's state. Try again.");
}

/** Current state, or null when nothing was ever written to the store (callers fall back to team prefs). */
export async function readState(b: Backend, key: string): Promise<SpaceState | null> {
  return (await readLatest(b, key, false)).state;
}

/**
 * Compare-and-swap update. `mutate` gets the latest state (and whether it came from `fallback`) and returns the
 * fields to change (null: no change); it may run more than once, so it must be a pure function of its input. `fallback` supplies the state to
 * start from when the store is still empty (the team prefs values).
 */
export async function patchState(
  b: Backend, key: string, mutate: (s: SpaceState, fromFallback: boolean) => Partial<SpaceState> | null, fallback: () => Promise<SpaceState> | SpaceState,
): Promise<SpaceState> {
  const perms: string[] = []; // server only: invites carry token hashes
  for (let attempt = 0; attempt < 40; attempt++) {
    const readAt = Date.now();
    const { n, state } = await readLatest(b, key, true);
    const base = state ?? stateFrom(await fallback());
    const patch = mutate(base, !state);
    if (!patch) return base;
    const next: SpaceState = { ...base, ...patch };
    if (n === 0) {
      try { await b.files.put(bucket(), stateFileId(key, 0), `${stateFileId(key, 0)}.json`, enc.encode(JSON.stringify({ marker: true, at: new Date().toISOString() })), perms); }
      catch (e) { if (!isConflict(e)) throw e; }
    }
    if (Date.now() - readAt > WRITE_WINDOW_MS) continue; // too slow to trust the read: read again
    const fileId = stateFileId(key, n + 1);
    try {
      await b.files.put(bucket(), fileId, `${fileId}.json`, enc.encode(JSON.stringify({ n: n + 1, at: new Date().toISOString(), state: next })), perms);
    } catch (e) {
      if (!isConflict(e)) throw e;
      // Someone else wrote n+1 first: re-read and re-apply.
      await new Promise((r) => setTimeout(r, Math.random() * 10 * Math.min(attempt + 1, 8)));
      continue;
    }
    hintsOf(b).set(key, n + 1);
    if ((n + 1) % PRUNE_EVERY === 0) await pruneState(b, key).catch((e) => console.warn("[engram] could not prune space state", e));
    return next;
  }
  throw new EngramError("chain_busy", "This space's state is changing too quickly. Try again.");
}

/** Delete old versions, lowest first; stop at the first failure so the kept versions stay one contiguous run. */
export async function pruneState(b: Backend, key: string) {
  const v = await listVersions(b, key);
  if (v.length <= KEEP) return;
  const newest = v[v.length - 1];
  const cutoff = Date.parse(newest.createdAt) - PRUNE_AGE_MS;
  for (const f of v) {
    if (f.n > newest.n - KEEP || !(Date.parse(f.createdAt) <= cutoff)) break;
    await b.files.delete(bucket(), f.fileId);
  }
}

/** Remove every state file of a space (space deletion only). */
export async function purgeState(b: Backend, key: string) {
  const files = await b.files.list(bucket(), statePrefix(key));
  await Promise.all(files.map((f) => b.files.delete(bucket(), f.fileId)));
  hintsOf(b).delete(key);
}
