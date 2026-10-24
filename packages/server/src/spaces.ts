import { newSpaceKey, SPACE_KEY_RE, teamIdFor } from "@engram/core";
import type { Backend } from "./backend/types";
import { getConfig } from "./config";
import { ConflictError, EngramError } from "./errors";
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
      if (e instanceof ConflictError && !args.key) continue;
      throw e;
    }
    const settings = defaultSettings({ spaceKey: key, name: args.name, ownerId: args.ownerId, sandbox: args.sandbox, publicVerify: args.publicVerify, description: args.description, local: b.kind === "local" });
    if (args.ownerName) settings.people[args.ownerId] = args.ownerName;
    if (args.ownerId) await b.teams.addMember(teamId, args.ownerId, ["owner"]);
    await b.teams.updatePrefs(teamId, settings);
    return { key, teamId, settings };
  }
  throw new EngramError("internal", "Could not allocate a space key.");
}

export async function updateSettings(b: Backend, key: string, patch: Partial<SpaceSettings>): Promise<SpaceSettings> {
  const s = await requireSpace(b, key);
  const next = { ...s.settings, ...patch, spaceKey: key };
  await b.teams.updatePrefs(s.teamId, next);
  if (patch.name && patch.name !== s.settings.name) await b.teams.rename(s.teamId, patch.name);
  return next;
}

export async function membership(b: Backend, key: string, userId: string) {
  return b.teams.membership(teamIdFor(key), userId);
}

export async function listSpacesForUser(b: Backend, userId: string): Promise<SpaceInfo[]> {
  const teams = (await b.teams.listForUser(userId)).filter((t) => t.teamId.startsWith("sp_"));
  const spaces = await Promise.all(teams.map((t) => getSpace(b, t.teamId.slice(3))));
  return spaces.filter((s): s is SpaceInfo => !!s);
}

export async function listAllSpaces(b: Backend): Promise<SpaceInfo[]> {
  const teams = await b.teams.listAll("sp_");
  const spaces = await Promise.all(teams.map((t) => getSpace(b, t.teamId.slice(3))));
  return spaces.filter((s): s is SpaceInfo => !!s);
}

/** Danger zone: remove every document, checkpoint file and the team. */
export async function deleteSpace(b: Backend, key: string) {
  const s = await requireSpace(b, key);
  await purgeSpaceData(b, key);
  await b.teams.delete(s.teamId);
}

export async function purgeSpaceData(b: Backend, key: string) {
  for (const coll of ["memories", "concepts", "recalls", "agents"] as const) {
    if (coll === "agents") continue;
    for (;;) {
      const docs = await b.vectors.query(coll, { filters: [{ op: "eq", path: "metadata.space", values: [key] }], limit: 100, withVectors: false });
      if (!docs.length) break;
      await Promise.all(docs.map((d) => b.vectors.delete(coll, d.$id)));
    }
  }
  const cfg = getConfig();
  for (const prefix of [`cp_${key}_`, `cpl_${key}_`]) {
    const files = await b.files.list(cfg.appwrite.checkpointsBucket, prefix);
    await Promise.all(files.map((f) => b.files.delete(cfg.appwrite.checkpointsBucket, f.fileId)));
  }
}

export const personName = (settings: SpaceSettings, actor: string) =>
  actor.startsWith("user:") ? settings.people[actor.slice(5)] ?? "a person" : actor;
