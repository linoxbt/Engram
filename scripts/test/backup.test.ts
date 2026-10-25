import { describe, expect, it } from "vitest";
import { AppwriteException, type Storage, type Teams } from "node-appwrite";
import { collectBackup, restoreBackup } from "../lib/backup";

/** Minimal in-memory stand-ins for the Teams and Storage services. */
function fakes() {
  const teamPrefs = new Map<string, { name: string; prefs: Record<string, unknown> }>([
    ["sp_abcdefgh", { name: "Demo", prefs: { spaceKey: "abcdefgh", latestCheckpoint: { size: 40 } } }],
    ["other", { name: "Not a space", prefs: {} }],
  ]);
  const files = new Map<string, { name: string; body: string; perms: string[] }>([["checkpoints/cp_abcdefgh_000000000039", { name: "cp_abcdefgh_000000000039.json", body: '{"seq":"39"}', perms: ['read("team:sp_abcdefgh")'] }]]);
  const nf = () => new AppwriteException("not found", 404, "not_found", "");
  const teams = {
    list: async () => ({ teams: [...teamPrefs.entries()].map(([$id, t]) => ({ $id, name: t.name })) }),
    getPrefs: async ({ teamId }: { teamId: string }) => { const t = teamPrefs.get(teamId); if (!t) throw nf(); return t.prefs; },
    listMemberships: async () => ({ memberships: [{ $id: "m1", userId: "u1", userEmail: "owner@example.com", roles: ["admin"] }] }),
    create: async ({ teamId, name }: { teamId: string; name: string }) => { teamPrefs.set(teamId, { name, prefs: {} }); },
    updatePrefs: async ({ teamId, prefs }: { teamId: string; prefs: Record<string, unknown> }) => { teamPrefs.get(teamId)!.prefs = prefs; },
  } as unknown as Teams;
  const storage = {
    listFiles: async ({ bucketId }: { bucketId: string }) => ({ files: [...files.entries()].filter(([k]) => k.startsWith(`${bucketId}/`)).map(([k, f]) => ({ $id: k.split("/")[1], name: f.name, $permissions: f.perms, mimeType: "application/json" })) }),
    getFileView: async ({ bucketId, fileId }: { bucketId: string; fileId: string }) => new TextEncoder().encode(files.get(`${bucketId}/${fileId}`)!.body).buffer,
    createFile: async ({ bucketId, fileId, permissions }: { bucketId: string; fileId: string; permissions: string[] }) => {
      if (files.has(`${bucketId}/${fileId}`)) throw new AppwriteException("exists", 409, "storage_file_already_exists", "");
      files.set(`${bucketId}/${fileId}`, { name: fileId, body: "restored", perms: permissions });
    },
  } as unknown as Storage;
  return { teams, storage, teamPrefs, files };
}

describe("backup", () => {
  it("exports space teams (not other teams) with prefs and members, and every bucket file", async () => {
    const f = fakes();
    const dump = await collectBackup(f.teams, f.storage, ["checkpoints"], { endpoint: "https://x/v1", project: "p" });
    expect(dump.teams.map((t) => t.teamId)).toEqual(["sp_abcdefgh"]);
    expect(dump.teams[0]).toMatchObject({ prefs: { spaceKey: "abcdefgh" }, members: [{ email: "owner@example.com", roles: ["admin"] }] });
    expect(dump.files).toHaveLength(1);
    expect(Buffer.from(dump.files[0].base64, "base64").toString()).toBe('{"seq":"39"}');
  });

  it("restores only what is missing and never overwrites an existing space's settings", async () => {
    const src = fakes();
    const dump = await collectBackup(src.teams, src.storage, ["checkpoints"], { endpoint: "https://x/v1", project: "p" });
    const dst = fakes();
    // The live space has moved on: its anchor must not go back to the backup's size 40.
    dst.teamPrefs.get("sp_abcdefgh")!.prefs = { spaceKey: "abcdefgh", latestCheckpoint: { size: 64 } };
    let r = await restoreBackup(dst.teams, dst.storage, dump, false, () => undefined);
    expect(r).toEqual({ teamsMade: 0, teamsKept: 1, filesMade: 0, filesKept: 1 });
    expect(dst.teamPrefs.get("sp_abcdefgh")!.prefs.latestCheckpoint).toEqual({ size: 64 });

    dst.teamPrefs.delete("sp_abcdefgh");
    dst.files.clear();
    r = await restoreBackup(dst.teams, dst.storage, dump, false, () => undefined);
    expect(r).toEqual({ teamsMade: 1, teamsKept: 0, filesMade: 1, filesKept: 0 });
    expect(dst.teamPrefs.get("sp_abcdefgh")).toMatchObject({ name: "Demo", prefs: { latestCheckpoint: { size: 40 } } });
  });

  it("a dry run changes nothing", async () => {
    const src = fakes();
    const dump = await collectBackup(src.teams, src.storage, ["checkpoints"], { endpoint: "https://x/v1", project: "p" });
    const dst = fakes();
    dst.teamPrefs.delete("sp_abcdefgh");
    dst.files.clear();
    await restoreBackup(dst.teams, dst.storage, dump, true, () => undefined);
    expect(dst.teamPrefs.has("sp_abcdefgh")).toBe(false);
    expect(dst.files.size).toBe(0);
  });
});
