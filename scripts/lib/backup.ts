/** Export and conservative restore of what database backups do not cover (see scripts/backup.ts). */
import { AppwriteException, Query, type Storage, type Teams } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

export interface BackupFile { format: "engram-backup-v1"; createdAt: string; endpoint: string; project: string; teams: TeamDump[]; files: FileDump[] }
export interface TeamDump { teamId: string; name: string; prefs: Record<string, unknown>; members: { userId: string; email: string; roles: string[] }[] }
export interface FileDump { bucketId: string; fileId: string; name: string; permissions: string[]; mimeType: string; base64: string }

async function toBuffer(x: unknown): Promise<Buffer> {
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === "string") return Buffer.from(x);
  if (x && typeof (x as Blob).arrayBuffer === "function") return Buffer.from(await (x as Blob).arrayBuffer());
  throw new Error(`unexpected file body ${Object.prototype.toString.call(x)}`);
}

export async function collectBackup(teams: Teams, storage: Storage, buckets: string[], meta: { endpoint: string; project: string }): Promise<BackupFile> {
  const dump: BackupFile = { format: "engram-backup-v1", createdAt: new Date().toISOString(), endpoint: meta.endpoint, project: meta.project, teams: [], files: [] };
  for (let cursor: string | undefined; ;) {
    const page = await teams.list({ queries: [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
    for (const t of page.teams.filter((t) => t.$id.startsWith("sp_"))) {
      const prefs = (await teams.getPrefs({ teamId: t.$id })) as Record<string, unknown>;
      const members: TeamDump["members"] = [];
      for (let mc: string | undefined; ;) {
        const m = await teams.listMemberships({ teamId: t.$id, queries: [Query.limit(100), ...(mc ? [Query.cursorAfter(mc)] : [])] });
        members.push(...m.memberships.map((x) => ({ userId: x.userId, email: x.userEmail, roles: x.roles })));
        if (m.memberships.length < 100) break;
        mc = m.memberships[m.memberships.length - 1].$id;
      }
      dump.teams.push({ teamId: t.$id, name: t.name, prefs, members });
    }
    if (page.teams.length < 100) break;
    cursor = page.teams[page.teams.length - 1].$id;
  }
  for (const bucketId of buckets) {
    for (let cursor: string | undefined; ;) {
      const page = await storage.listFiles({ bucketId, queries: [Query.limit(100), Query.orderAsc("$id"), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
      for (const f of page.files) {
        const body = await toBuffer(await storage.getFileView({ bucketId, fileId: f.$id }));
        dump.files.push({ bucketId, fileId: f.$id, name: f.name, permissions: f.$permissions, mimeType: f.mimeType, base64: body.toString("base64") });
      }
      if (page.files.length < 100) break;
      cursor = page.files[page.files.length - 1].$id;
    }
  }
  return dump;
}

export async function restoreBackup(teams: Teams, storage: Storage, dump: BackupFile, dry: boolean, log: (s: string) => void = console.log) {
  if (dump.format !== "engram-backup-v1") throw new Error("not an Engram backup");
  let teamsMade = 0, teamsKept = 0, filesMade = 0, filesKept = 0;
  for (const t of dump.teams) {
    const existing = await teams.getPrefs({ teamId: t.teamId }).then((p) => p as Record<string, unknown>, (e) => { if (e instanceof AppwriteException && e.code === 404) return null; throw e; });
    if (existing && existing.spaceKey) { teamsKept++; continue; }
    log(`${dry ? "would restore" : "restoring"} space ${t.teamId} (${t.name}); members to re-invite: ${t.members.map((m) => `${m.email} [${m.roles.join("/")}]`).join(", ") || "none"}`);
    if (dry) continue;
    if (!existing) await teams.create({ teamId: t.teamId, name: t.name });
    await teams.updatePrefs({ teamId: t.teamId, prefs: t.prefs });
    teamsMade++;
  }
  for (const f of dump.files) {
    if (dry) { log(`would restore ${f.bucketId}/${f.fileId}`); continue; }
    try {
      await storage.createFile({ bucketId: f.bucketId, fileId: f.fileId, file: InputFile.fromBuffer(Buffer.from(f.base64, "base64"), f.name), permissions: f.permissions });
      filesMade++;
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 409) filesKept++;
      else throw e;
    }
  }
  log(`${dry ? "Dry run: " : ""}spaces restored ${teamsMade}, left as they are ${teamsKept}; files restored ${filesMade}, already present ${filesKept}.`);
  return { teamsMade, teamsKept, filesMade, filesKept };
}
