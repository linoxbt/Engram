import { newSpaceKey, SPACE_KEY_RE, teamIdFor } from "@engram/core";
import type { Backend } from "./backend/types";
import { getConfig } from "./config";
import { EngramError, isConflict } from "./errors";
import { defaultSettings, type CheckpointPointer, type SpaceSettings } from "./settings";
import type { SpaceInfo } from "./context";
import { isStateKey, patchState, purgeState, readState, stateFrom, STATE_KEYS, type SpaceState } from "./state";

export async function getSpace(b: Backend, key: string): Promise<SpaceInfo | null> {
  if (!SPACE_KEY_RE.test(key)) return null;
  const teamId = teamIdFor(key);
  const [prefs, state] = await Promise.all([b.teams.getPrefs<SpaceSettings>(teamId), readState(b, key)]);
  if (!prefs || !prefs.spaceKey) return null;
  // Server-owned state comes from the state store; until its first write, from the values still in team prefs.
  const base = { ...defaultSettings({ spaceKey: key, name: key, ownerId: "", local: b.kind === "local" }), ...prefs };
  return { key, teamId, settings: { ...base, ...(state ?? stateFrom(prefs)) } };
}

export async function requireSpace(b: Backend, key: string): Promise<SpaceInfo> {
  const s = await getSpace(b, key);
  if (!s) throw new EngramError("not_found", `Space ${key} not found.`);
  return s;
}

export async function createSpace(b: Backend, args: { name: string; ownerId: string; ownerName?: string; description?: string; publicVerify?: boolean; sandbox?: boolean; key?: string }): Promise<SpaceInfo> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = args.key ?? newSpaceKey();
    const teamId = teamIdFor(key);
    try {
      await b.teams.create(teamId, args.name);
    } catch (e) {
      if (isConflict(e) && !args.key) continue;
      throw e;
    }
    const settings = defaultSettings({ spaceKey: key, name: args.name, ownerId: args.ownerId, sandbox: args.sandbox, publicVerify: args.publicVerify, description: args.description, local: b.kind === "local" });
    if (args.ownerName) settings.people[args.ownerId] = args.ownerName;
    if (args.ownerId) await b.teams.addMember(teamId, args.ownerId, [OWNER_ROLE]);
    await b.teams.updatePrefs(teamId, withoutState(settings));
    return { key, teamId, settings };
  }
  throw new EngramError("internal", "Could not allocate a space key.");
}

/**
 * Space owners get a custom role, not Appwrite's built-in "owner": that one lets the user call Teams.updatePrefs
 * directly with the Realtime JWT and rewrite server-owned settings (sandbox, integrity, latestCheckpoint).
 * Spaces created before this change carry "owner" and are still recognised.
 */
export const OWNER_ROLE = "admin";
export const isOwnerRole = (roles: string[]) => roles.includes(OWNER_ROLE) || roles.includes("owner");

/** Team prefs never carry the state-store fields once written by this code. */
function withoutState<T extends object>(prefs: T): T {
  const out = { ...prefs } as Record<string, unknown>;
  for (const k of STATE_KEYS) delete out[k];
  return out as T;
}
const hasStateValues = (prefs: Partial<SpaceSettings>) => !!prefs.integrity || !!prefs.seeding || !!prefs.invites?.length;

/** The checkpoint pointer is the server-side trust anchor: it only moves forward. */
export const checkpointAdvances = (prev: CheckpointPointer | null | undefined, next: CheckpointPointer | null) =>
  !prev || (!!next && next.size >= prev.size);

const prefsQueues = new WeakMap<Backend, Map<string, Promise<unknown>>>();
const sameValues = (a: Partial<SpaceSettings>, b: Partial<SpaceSettings>) =>
  Object.keys(a).every((k) => JSON.stringify(a[k as keyof SpaceSettings]) === JSON.stringify(b[k as keyof SpaceSettings]));

async function prefsState(b: Backend, key: string): Promise<SpaceState> {
  const prefs = await b.teams.getPrefs<SpaceSettings>(teamIdFor(key));
  if (!prefs?.spaceKey) throw new EngramError("not_found", `Space ${key} not found.`);
  return stateFrom(prefs);
}

/**
 * Settings changes. `integrity`, `seeding` and `invites` go to the state store (compare-and-swap, see state.ts),
 * so they can never be lost to, or revert, a concurrent write. Everything else lives in team prefs, which have no
 * conditional write: those writes are serialised per space within a process, re-read just before writing, and
 * checked afterwards: if a concurrent writer elsewhere replaced our fields with a stale copy, the patch is
 * applied again. `latestCheckpoint` never moves backwards.
 */
export async function updateSettings(b: Backend, key: string, patch: Partial<SpaceSettings>): Promise<SpaceSettings> {
  const statePatch: Partial<SpaceState> = {};
  const prefsPatch: Partial<SpaceSettings> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isStateKey(k)) (statePatch as Record<string, unknown>)[k] = v;
    else (prefsPatch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(statePatch).length) await patchState(b, key, () => statePatch, () => prefsState(b, key));
  if (Object.keys(prefsPatch).length) await writePrefs(b, key, prefsPatch);
  return { ...(await requireSpace(b, key)).settings };
}

/** Compare-and-swap on the state store: `mutate` sees the latest state and may run more than once. */
export async function updateSpaceState(b: Backend, key: string, mutate: (s: SpaceState) => Partial<SpaceState> | null): Promise<SpaceState> {
  return patchState(b, key, mutate, () => prefsState(b, key));
}

async function writePrefs(b: Backend, key: string, patch: Partial<SpaceSettings>, opts: { resetCheckpoint?: boolean } = {}) {
  let queues = prefsQueues.get(b);
  if (!queues) prefsQueues.set(b, (queues = new Map()));
  const q = queues;
  const prev = q.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const teamId = teamIdFor(key);
    for (let attempt = 0; attempt < 4; attempt++) {
      const prefs = await b.teams.getPrefs<SpaceSettings>(teamId);
      if (!prefs?.spaceKey) throw new EngramError("not_found", `Space ${key} not found.`);
      const p = { ...patch };
      if (p.latestCheckpoint !== undefined && !opts.resetCheckpoint && !checkpointAdvances(prefs.latestCheckpoint, p.latestCheckpoint)) {
        console.warn(`[engram] refused to move the latest checkpoint of ${key} backwards`);
        delete p.latestCheckpoint;
      }
      if (!Object.keys(p).length) return;
      // Lazy migration: state values still in prefs move to the store before prefs drop them.
      if (hasStateValues(prefs)) await patchState(b, key, (_s, fromPrefs) => (fromPrefs ? {} : null), () => stateFrom(prefs));
      await b.teams.updatePrefs(teamId, withoutState({ ...prefs, ...p, spaceKey: key }));
      if (p.name && p.name !== prefs.name) await b.teams.rename(teamId, p.name);
      await new Promise((r) => setTimeout(r, 40 + attempt * 60));
      const after = await b.teams.getPrefs<SpaceSettings>(teamId);
      if (!after || sameValues(p, after)) return;
    }
  });
  q.set(key, run);
  try { await run; } finally { if (q.get(key) === run) q.delete(key); }
}

export async function membership(b: Backend, key: string, userId: string) {
  return b.teams.membership(teamIdFor(key), userId);
}

export async function listSpacesForUser(b: Backend, userId: string): Promise<SpaceInfo[]> {
  const teams = (await b.teams.listForUser(userId)).filter((t) => t.teamId.startsWith("sp_"));
  const spaces = await Promise.all(teams.map((t) => getSpace(b, t.teamId.slice(3))));
  return spaces.filter((s): s is SpaceInfo => !!s);
}

/** For scheduled Functions: bounded parallelism, and one unreadable team is skipped rather than failing the run. */
export async function listAllSpaces(b: Backend, concurrency = 8): Promise<SpaceInfo[]> {
  const teams = await b.teams.listAll("sp_");
  const out: (SpaceInfo | null)[] = [];
  let next = 0;
  const worker = async () => {
    while (next < teams.length) {
      const i = next++;
      try { out[i] = await getSpace(b, teams[i].teamId.slice(3)); }
      catch (e) { console.error(`[engram] could not read space ${teams[i].teamId}`, e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, teams.length) }, worker));
  return out.filter((s): s is SpaceInfo => !!s);
}

/** Danger zone: remove every document (agents and their keys included), checkpoint and export file, then the team. */
export async function deleteSpace(b: Backend, key: string) {
  const s = await requireSpace(b, key);
  await purgeSpaceData(b, key, { agents: true });
  await b.teams.delete(s.teamId);
  await purgeState(b, key);
}

/**
 * Safe to retry: each pass deletes whatever is left. The Tamper Lab reset keeps agents so their keys still work,
 * and resets what described the deleted data: integrity status, seeding progress and the checkpoint pointer.
 */
export async function purgeSpaceData(b: Backend, key: string, opts: { agents?: boolean } = {}) {
  const colls = ["memories", "concepts", "recalls", ...(opts.agents ? (["agents"] as const) : [])] as const;
  for (const coll of colls) {
    for (;;) {
      const docs = await b.vectors.query(coll, { filters: [{ op: "eq", path: "metadata.space", values: [key] }], limit: 100, withVectors: false });
      if (!docs.length) break;
      await Promise.all(docs.map((d) => b.vectors.delete(coll, d.$id)));
    }
  }
  const cfg = getConfig();
  const cps = cfg.appwrite.checkpointsBucket;
  const targets: [string, string][] = [
    [cps, `cp_${key}_`], [cps, `cpl_${key}_`], [cps, `idm_${key}_`], [cfg.appwrite.exportsBucket, `ex_${key}_`],
    // Space deletion: used-invite markers too (the state files go after the team, in deleteSpace).
    ...(opts.agents ? ([[cps, `ivc_${key}_`]] as [string, string][]) : []),
  ];
  for (const [bucket, prefix] of targets) {
    const files = await b.files.list(bucket, prefix);
    await Promise.all(files.map((f) => b.files.delete(bucket, f.fileId)));
  }
  if (!opts.agents) {
    await updateSpaceState(b, key, (st) => (st.integrity || st.seeding ? { integrity: null, seeding: null } : null));
    await writePrefs(b, key, { latestCheckpoint: null }, { resetCheckpoint: true });
  }
}

export const personName = (settings: SpaceSettings, actor: string) =>
  actor.startsWith("user:") ? settings.people[actor.slice(5)] ?? "a person" : actor;
