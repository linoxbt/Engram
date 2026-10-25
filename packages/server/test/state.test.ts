/** The space state store: compare-and-swap writes shared by several processes, migration, pruning, purge. */
import { describe, expect, it } from "vitest";
import {
  deleteSpace, getConfig, getSpace, pruneState, purgeSpaceData, readState, stateFileId, statePrefix, updateSettings, updateSpaceState,
  type Backend, type IntegrityStatus, type SpaceInvite,
} from "../src/index";
import { setup } from "./helpers";

/** A second "process": same storage, its own in-memory caches (hints, write queues). */
const otherProcess = (b: Backend): Backend => ({ ...b });
const integrity = (status: IntegrityStatus["status"], entries = 1): IntegrityStatus =>
  ({ status, validThrough: entries - 1, entries, findings: 0, critical: 0, checkedAt: new Date().toISOString(), firstFinding: null });
const invite = (id: string): SpaceInvite =>
  ({ id, tokenHash: "00", email: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdBy: "u" });
const bucket = () => getConfig().appwrite.checkpointsBucket;
/** `obj` with some methods replaced (class instances keep their prototype methods). */
const wrap = <T extends object>(obj: T, overrides: Partial<T>): T => Object.assign(Object.create(obj) as T, overrides);

describe("space state store", () => {
  it("concurrent writers in two processes never lose an update", async () => {
    const { b, space } = await setup();
    const b2 = otherProcess(b);
    const writes = Array.from({ length: 24 }, (_, i) => updateSpaceState(i % 2 ? b2 : b, space.key, (s) => ({ invites: [...s.invites, invite(`inv${i}`)] })));
    await Promise.all([
      ...writes,
      updateSettings(b2, space.key, { integrity: integrity("valid", 7) }),
      updateSettings(b, space.key, { seeding: { variant: "demo", background: null, next: 3, total: 9, byKey: {}, entries: 3, duplicates: 0, createdBy: "seed" } }),
    ]);
    for (const proc of [b, b2, otherProcess(b)]) {
      const s = (await getSpace(proc, space.key))!.settings;
      expect(s.invites!.map((i) => i.id).sort()).toEqual(Array.from({ length: 24 }, (_, i) => `inv${i}`).sort());
      expect(s.integrity?.entries).toBe(7);
      expect(s.seeding?.next).toBe(3);
    }
  });

  it("an integrity write cannot revert the owner's publicVerify:false, and never touches team prefs", async () => {
    const { b, space } = await setup();
    expect(space.settings.publicVerify).toBe(true);
    const b2 = otherProcess(b);
    let prefsWrites = 0;
    b2.teams = wrap(b.teams, { updatePrefs: async (...args: Parameters<Backend["teams"]["updatePrefs"]>) => { prefsWrites++; return b.teams.updatePrefs(...args); } });
    // The integrity writer reads first, the owner writes while it is in flight.
    const sentinel = Promise.all([1, 2, 3].map((n) => updateSettings(b2, space.key, { integrity: integrity("valid", n) })));
    await updateSettings(b, space.key, { publicVerify: false });
    await sentinel;
    expect(prefsWrites).toBe(0);
    const s = (await getSpace(b, space.key))!.settings;
    expect(s.publicVerify).toBe(false);
    expect(s.integrity?.status).toBe("valid");
  });

  it("the checkpoint pointer never moves backwards", async () => {
    const { b, space } = await setup();
    const cp = (size: number) => ({ fileId: `cp_${space.key}_${String(size - 1).padStart(12, "0")}`, seq: size - 1, size, root: "aa", createdAt: new Date().toISOString() });
    await updateSettings(b, space.key, { latestCheckpoint: cp(10) });
    await updateSettings(b, space.key, { latestCheckpoint: cp(5), name: "Renamed" });
    await updateSettings(b, space.key, { latestCheckpoint: null });
    const s = (await getSpace(b, space.key))!.settings;
    expect(s.latestCheckpoint?.size).toBe(10);
    expect(s.name).toBe("Renamed");
    await updateSettings(b, space.key, { latestCheckpoint: cp(12) });
    expect((await getSpace(b, space.key))!.settings.latestCheckpoint?.size).toBe(12);
  });

  it("migrates lazily: values still in team prefs are read, then moved to the store and dropped from prefs", async () => {
    const { b, space } = await setup();
    const prefs = (await b.teams.getPrefs<Record<string, unknown>>(space.teamId))!;
    await b.teams.updatePrefs(space.teamId, { ...prefs, invites: [invite("old")], integrity: integrity("warning", 3) });
    expect(await readState(b, space.key)).toBeNull();
    expect((await getSpace(b, space.key))!.settings.invites!.map((i) => i.id)).toEqual(["old"]);

    await updateSettings(b, space.key, { description: "now migrated" });
    expect((await readState(b, space.key))!.invites.map((i) => i.id)).toEqual(["old"]);
    const after = (await b.teams.getPrefs<Record<string, unknown>>(space.teamId))!;
    expect(after).not.toHaveProperty("invites");
    expect(after).not.toHaveProperty("integrity");
    const s = (await getSpace(b, space.key))!.settings;
    expect(s.integrity?.status).toBe("warning");
    expect(s.description).toBe("now migrated");
  });

  it("prunes old versions from the bottom; processes with stale hints still find the latest and never reuse a pruned number", async () => {
    const { b, space } = await setup();
    const stale = otherProcess(b);
    await updateSettings(stale, space.key, { integrity: integrity("valid", 1) }); // stale's hint: version 1
    for (let i = 2; i <= 25; i++) await updateSettings(b, space.key, { integrity: integrity("valid", i) });
    // Pretend version n was written n minutes after the first, so the oldest are past the pruning age.
    const t0 = Date.now() - 3_600_000;
    const versionOf = (name: string) => Number(name.slice(statePrefix(space.key).length, statePrefix(space.key).length + 12));
    const aged: Backend = { ...b, files: wrap(b.files, { list: async (bk: string, prefix: string) => (await b.files.list(bk, prefix)).map((f) => ({ ...f, createdAt: new Date(t0 + versionOf(f.name) * 60_000).toISOString() })) }) };
    await pruneState(aged, space.key);
    const left = (await b.files.list(bucket(), statePrefix(space.key))).map((f) => f.name).sort();
    expect(left[0]).toBe(`${stateFileId(space.key, 0)}.json`); // the marker stays
    expect(left.slice(1)).toEqual(Array.from({ length: 10 }, (_, i) => `${stateFileId(space.key, 16 + i)}.json`));

    expect((await readState(stale, space.key))!.integrity?.entries).toBe(25);
    expect((await readState(otherProcess(b), space.key))!.integrity?.entries).toBe(25);
    await updateSettings(otherProcess(stale), space.key, { integrity: integrity("valid", 26) });
    await updateSettings(stale, space.key, { integrity: integrity("valid", 27) });
    expect(await b.files.get(bucket(), stateFileId(space.key, 2))).toBeNull();
    expect((await getSpace(b, space.key))!.settings.integrity?.entries).toBe(27);
  });

  it("does not prune versions that are still young", async () => {
    const { b, space } = await setup();
    for (let i = 1; i <= 30; i++) await updateSettings(b, space.key, { integrity: integrity("valid", i) });
    expect((await b.files.list(bucket(), statePrefix(space.key))).length).toBe(31);
  });
});

describe("purging a space", () => {
  it("deleting a space removes its state files, idempotency locks and used-invite markers", async () => {
    const { b, space } = await setup();
    await updateSettings(b, space.key, { integrity: integrity("valid") });
    await b.files.put(bucket(), `idm_${space.key}_${"a".repeat(24)}`, `idm_${space.key}_${"a".repeat(24)}.json`, new Uint8Array([1]), []);
    await b.files.put(bucket(), `ivc_${space.key}_abcdefghijkl`, `ivc_${space.key}_abcdefghijkl.json`, new Uint8Array([1]), []);
    await deleteSpace(b, space.key);
    for (const prefix of [statePrefix(space.key), `idm_${space.key}_`, `ivc_${space.key}_`]) expect(await b.files.list(bucket(), prefix)).toEqual([]);
    expect(await getSpace(b, space.key)).toBeNull();
  });

  it("a sandbox reset clears integrity, seeding progress and the checkpoint pointer", async () => {
    const { b, space } = await setup({ sandbox: true });
    await updateSettings(b, space.key, {
      integrity: integrity("tampered"), latestCheckpoint: { fileId: "x", seq: 3, size: 4, root: "aa", createdAt: new Date().toISOString() },
      seeding: { variant: "sandbox", background: null, next: 2, total: 9, byKey: {}, entries: 2, duplicates: 0, createdBy: "seed" },
    });
    await purgeSpaceData(b, space.key);
    const s = (await getSpace(b, space.key))!.settings;
    expect([s.integrity, s.seeding, s.latestCheckpoint]).toEqual([null, null, null]);
  });
});
