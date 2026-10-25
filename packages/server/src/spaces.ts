import { newSpaceKey, SPACE_KEY_RE, teamIdFor } from "@engram/core";
import type { Backend } from "./backend/types";
import { getConfig } from "./config";
import { EngramError, isConflict } from "./errors";
import { defaultSettings, type SpaceSettings } from "./settings";
import type { SpaceInfo } from "./context";

export async function getSpace(b: Backend, key: string): Promise<SpaceInfo | null> {
  if (!SPACE_KEY_RE.test(key)) return null;
  const teamId = teamIdFor(key);
  const prefs = await b.teams.getPrefs<SpaceSettings>(teamId);
  if (!prefs || !prefs.spaceKey) return null;
  return { key, teamId, settings: { ...defaultSettings({ spaceKey: key, name: key, ownerId: "", local: b.kind === "local" }), ...prefs } };
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
    await b.teams.updatePrefs(teamId, settings);
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

const settingsQueue = new Map<string, Promise<unknown>>();
const sameValues = (a: Partial<SpaceSettings>, b: Partial<SpaceSettings>) =>
  Object.keys(a).every((k) => JSON.stringify(a[k as keyof SpaceSettings]) === JSON.stringify(b[k as keyof SpaceSettings]));

/**
 * Team prefs are one object with no conditional write, and the checkpoint Function, the sentinel and people all
 * patch it. Writes are serialised per space within a process, re-read just before writing, and checked
 * afterwards: if a concurrent writer elsewhere replaced our fields with a stale copy, the patch is applied again.
 */
export async function updateSettings(b: Backend, key: string, patch: Partial<SpaceSettings>): Promise<SpaceSettings> {
  const prev = settingsQueue.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    let next: SpaceSettings | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const s = await requireSpace(b, key);
      next = { ...s.settings, ...patch, spaceKey: key };
      await b.teams.updatePrefs(s.teamId, next);
      if (patch.name && patch.name !== s.settings.name) await b.teams.rename(s.teamId, patch.name);
      await new Promise((r) => setTimeout(r, 40 + attempt * 60));
      const after = await getSpace(b, key);
      if (!after || sameValues(patch, after.settings)) return after ? { ...after.settings } : next;
    }
    return next!;
  });
  settingsQueue.set(key, run);
  try { return await run; } finally { if (settingsQueue.get(key) === run) settingsQueue.delete(key); }
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
}

/** Safe to retry: each pass deletes whatever is left. The Tamper Lab reset keeps agents so their keys still work. */
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
  const targets: [string, string][] = [[cfg.appwrite.checkpointsBucket, `cp_${key}_`], [cfg.appwrite.checkpointsBucket, `cpl_${key}_`], [cfg.appwrite.exportsBucket, `ex_${key}_`]];
  for (const [bucket, prefix] of targets) {
    const files = await b.files.list(bucket, prefix);
    await Promise.all(files.map((f) => b.files.delete(bucket, f.fileId)));
  }
}

export const personName = (settings: SpaceSettings, actor: string) =>
  actor.startsWith("user:") ? settings.people[actor.slice(5)] ?? "a person" : actor;
