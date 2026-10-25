/** Production-readiness: cost bounds on scheduled work and races found in the second audit. */
import { describe, expect, it, vi } from "vitest";
import { buildCheckpoint, checkpointFileId, signCheckpoint, type EntryMeta } from "@engram/core";
import {
  append, bearerMatches, createSpace, getConfig, getEntry, getSpace, labelConcept, latestCheckpoint, linkFound, listAllSpaces, loadChain, loadCheckpoints, recall,
  reflect, remember, repairSpace, runCheckpoint, runSentinel, updateSettings, verifyStoredSpace, ConflictError, RememberInput, type Collection,
} from "../src/index";
import { setup } from "./helpers";

describe("checkpoint Function cost", () => {
  it("an idle space costs no file reads, and a busy one downloads only the newest checkpoint", async () => {
    const { b, ctx, keys } = await setup();
    for (let i = 0; i < 3; i++) await append(ctx, { op: "remember", kind: "fact", subject: null, text: `fact ${i}` });
    // Checkpoints written outside this process (not in the file cache), as a cold Function container sees them.
    const hashes = (await loadChain(b, ctx.space.key)).map((e) => e.metadata.hash);
    const bucket = getConfig().appwrite.checkpointsBucket;
    let prev = null;
    for (let n = 1; n <= 3; n++) {
      const cp = await signCheckpoint(await buildCheckpoint({ space: ctx.space.key, hashes: hashes.slice(0, n), prev, keyId: "test" }), keys.privateKey);
      await b.files.put(bucket, checkpointFileId(cp), `${checkpointFileId(cp)}.json`, new TextEncoder().encode(JSON.stringify(cp)), []);
      prev = cp;
    }
    const get = vi.spyOn(b.files, "get");
    expect(Number((await latestCheckpoint(b, ctx.space.key))!.size)).toBe(3);
    expect(get).toHaveBeenCalledTimes(1);

    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "fact 3" });
    get.mockClear();
    const run = await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    expect(run.created).toBe(true);
    expect(get.mock.calls.filter(([, id]) => id.startsWith("cp_")).length).toBeLessThanOrEqual(1);
    expect(run.checkpoint!.prevCheckpoint).toBe(checkpointFileId(prev!));

    const list = vi.spyOn(b.files, "list");
    const idle = await runCheckpoint(b, (await getSpace(b, ctx.space.key))!, { privateKey: keys.privateKey });
    expect(idle).toMatchObject({ created: false, reason: "no new entries" });
    expect(list).not.toHaveBeenCalled();
    expect(await loadCheckpoints(b, ctx.space.key)).toHaveLength(4);
    expect((await verifyStoredSpace(b, ctx.space)).status).toBe("valid");
  });

  it("one unreadable team does not abort listing every space", async () => {
    const { b, space } = await setup();
    await b.teams.create("sp_zzzzzzzz", "broken");
    const getPrefs = b.teams.getPrefs.bind(b.teams);
    b.teams.getPrefs = (async (id: string) => { if (id === "sp_zzzzzzzz") throw new Error("boom"); return getPrefs(id); }) as typeof b.teams.getPrefs;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const keys = (await listAllSpaces(b)).map((s) => s.key);
    err.mockRestore();
    expect(keys).toContain(space.key);
    expect(keys).not.toContain("zzzzzzzz");
  });
});

describe("checkpoint lock reclaim", () => {
  const enc = (o: object) => new TextEncoder().encode(JSON.stringify(o));
  const stale = () => enc({ at: new Date(Date.now() - 10 * 60_000).toISOString(), prev: null, token: "dead" });

  it("a reclaim never deletes a fresh lock another run took after it read the stale one", async () => {
    const { b, ctx, keys } = await setup();
    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "fact 0" });
    const bucket = getConfig().appwrite.checkpointsBucket;
    const lockId = `cpl_${ctx.space.key}_genesis`;
    await b.files.put(bucket, lockId, `${lockId}.json`, stale(), []);
    const fresh = enc({ at: new Date().toISOString(), prev: null, token: "other-run" });
    const get = b.files.get.bind(b.files);
    let armed = true;
    b.files.get = async (bk, id) => {
      const r = await get(bk, id);
      // Run A reclaims between our read of the stale lock and our delete.
      if (armed && id === lockId) { armed = false; await b.files.delete(bucket, lockId); await b.files.put(bucket, lockId, "x", fresh, []); }
      return r;
    };
    const run = await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    expect(run.created).toBe(false);
    expect(new TextDecoder().decode((await get(bucket, lockId))!)).toContain("other-run");
  });

  it("a reclaimed lock deleted by a concurrent reclaimer is not used", async () => {
    const { b, ctx, keys } = await setup();
    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "fact 0" });
    const bucket = getConfig().appwrite.checkpointsBucket;
    const lockId = `cpl_${ctx.space.key}_genesis`;
    await b.files.put(bucket, lockId, `${lockId}.json`, stale(), []);
    const put = b.files.put.bind(b.files);
    let puts = 0;
    b.files.put = async (bk, id, name, bytes, perms) => {
      await put(bk, id, name, bytes, perms);
      // Run B, which judged the same stale lock, deletes ours just after we create it and takes its own.
      if (id === lockId && ++puts === 1) { await b.files.delete(bk, id); await put(bk, id, name, enc({ at: new Date().toISOString(), prev: null, token: "b" }), []); }
    };
    const run = await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    expect(run.created).toBe(false);
    expect(await loadCheckpoints(b, ctx.space.key)).toHaveLength(0);
  });

  it("a stale lock is still reclaimed when nobody races", async () => {
    const { b, ctx, keys } = await setup();
    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "fact 0" });
    const bucket = getConfig().appwrite.checkpointsBucket;
    await b.files.put(bucket, `cpl_${ctx.space.key}_genesis`, "x", stale(), []);
    expect((await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey })).created).toBe(true);
  });
});

describe("recall access bumps", () => {
  it("bumps at most the top three, and a memory at most once per ten minutes", async () => {
    const { b, ctx, drain } = await setup();
    for (let i = 0; i < 6; i++) await remember(ctx, { text: `Northwind invoice ${i} was paid by Kestrel Foods in October`, subject: `customer:k${i}` });
    await drain();
    const access = async () => (await loadChain(b, ctx.space.key)).map((e) => Number(e.metadata.d.access));
    const r = await recall(ctx, { query: "Kestrel Foods invoice paid", k: 6 });
    expect(r.memories.length).toBeGreaterThan(3);
    await drain();
    expect((await access()).reduce((a, n) => a + n, 0)).toBe(3);
    await recall(ctx, { query: "Kestrel Foods invoice paid", k: 6 });
    await drain();
    // The three already bumped are skipped; the next three get theirs.
    expect((await access()).filter((n) => n === 1).length).toBe(Math.min(6, r.memories.length));
    await recall(ctx, { query: "Kestrel Foods invoice paid", k: 6 });
    await drain();
    expect(Math.max(...(await access()))).toBe(1);
  });
});

describe("sentinel time budget", () => {
  it("checks the least recently checked spaces first and reports the ones it had no time for", async () => {
    const { b, user } = await setup();
    const spaces = [];
    for (const at of ["2026-10-20T00:00:00.000Z", null, "2026-10-10T00:00:00.000Z"]) {
      const s = await createSpace(b, { name: `S ${at}`, ownerId: user.id });
      if (at) await updateSettings(b, s.key, { integrity: { status: "valid", validThrough: -1, entries: 0, findings: 0, critical: 0, checkedAt: at, firstFinding: null } });
      spaces.push((await getSpace(b, s.key))!);
    }
    const all = await runSentinel(b, { spaces });
    expect(all.results.map((r) => r.space)).toEqual([spaces[1].key, spaces[2].key, spaces[0].key]);
    expect(all.skipped).toEqual([]);

    const query = b.vectors.query.bind(b.vectors);
    b.vectors.query = (async (...args: Parameters<typeof query>) => { await new Promise((r) => setTimeout(r, 30)); return query(...args); }) as typeof query;
    const short = await runSentinel(b, { spaces, budgetMs: 20 });
    expect(short.results.map((r) => r.space)).toEqual([spaces[1].key]);
    expect(short.skipped).toEqual([spaces[2].key, spaces[0].key]);
  });
});

describe("repair under concurrent writers", () => {
  it("re-reads and recomputes on a conflict, never overwrites a newer neighbour update, and continues past contention", async () => {
    const { b, ctx } = await setup();
    const x = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "X" });
    const y = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Y" });
    const w = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "W" });
    // Searchable copies disagree with derived state on all three, so repair has work for each.
    for (const id of [x.id, y.id, w.id]) {
      const d = (await getEntry(b, id))!;
      await b.vectors.update<EntryMeta>("memories", id, { metadata: { ...d.metadata, status: "superseded" } });
    }
    const update = b.vectors.update.bind(b.vectors);
    let raced = false;
    b.vectors.update = (async (coll: Collection, id: string, data: never, perms?: string[], opts?: { ifUpdatedAt?: string }) => {
      if (id === w.id) throw new ConflictError("always contended");
      if (id === x.id && !raced) {
        raced = true;
        b.vectors.update = update; // the writer below uses the real store
        await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Z replaces X", refs: { supersedes: [x.id] } });
        b.vectors.update = wrapped;
      }
      return update(coll, id, data, perms, opts);
    }) as typeof update;
    const wrapped = b.vectors.update;
    const r = await repairSpace(ctx);
    b.vectors.update = update;
    expect(r.conflicts).toBe(1);
    const xd = (await getEntry(b, x.id))!.metadata;
    expect(xd.d.status).toBe("superseded");
    expect(xd.d.supersededBy).toBe(`m_${ctx.space.key}_000000000003`);
    expect((await getEntry(b, y.id))!.metadata.d.status).toBe("active");
    expect(r.fixed).toBe(1);
  });
});

describe("space isolation of id-taking calls", () => {
  it("labelling, reflecting on or linking another space's records is not found", async () => {
    const a = await setup();
    const other = await setup();
    const m = await remember(other.ctx, { text: "Kestrel Foods renewed their annual contract.", subject: "customer:kestrel" });
    await other.drain();
    const [concept] = await other.b.vectors.query<{ space: string; label: string }>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [other.space.key] }], limit: 1, withVectors: false });
    expect(concept).toBeTruthy();
    // Same backend for both, as in production: point the first space's context at the second's storage.
    const ctx = { ...a.ctx, b: other.b };
    await expect(labelConcept(ctx, concept.$id)).rejects.toThrow(/not found/);
    await expect(reflect(ctx, concept.$id)).rejects.toThrow(/not found/);
    await expect(linkFound(ctx, { target: m.id, other: m.id, kind: "contradict", reason: "" })).rejects.toThrow(/not found/);
    expect((await other.b.vectors.get<{ label: string }>("concepts", concept.$id))!.metadata.label).toBe(concept.metadata.label);
  });
});

describe("operator secrets", () => {
  it("match only the exact bearer secret", async () => {
    expect(await bearerMatches("Bearer s3cret-value", "s3cret-value")).toBe(true);
    for (const h of [null, "", "Bearer s3cret-valu", "Bearer s3cret-value ", "bearer s3cret-value", "s3cret-value"]) expect(await bearerMatches(h, "s3cret-value")).toBe(false);
  });
});

describe("input normalisation", () => {
  it("stores validFrom in the canonical 24-char form and rejects impossible dates", async () => {
    const { ctx } = await setup();
    const r = await remember(ctx, { text: "Ada moved to the Basic plan.", validFrom: "2026-10-20T10:00:00+01:00" });
    expect((await getEntry(ctx.b, r.id))!.metadata.h.validFrom).toBe("2026-10-20T09:00:00.000Z");
    expect(RememberInput.safeParse({ text: "Ada moved.", validFrom: "2026-02-30T00:00:00Z" }).success).toBe(false);
    expect(RememberInput.safeParse({ text: "Ada moved.", validFrom: "yesterday" }).success).toBe(false);
  });

  it("refuses an explicit createdAt far in the future, which would freeze the chain's clock", async () => {
    const { ctx } = await setup();
    const at = new Date(Date.now() + 10 * 60_000).toISOString();
    await expect(append(ctx, { op: "remember", kind: "fact", subject: null, text: "x", createdAt: at })).rejects.toThrow(/future/);
    await expect(append(ctx, { op: "remember", kind: "fact", subject: null, text: "x", createdAt: "2026-10-20" })).rejects.toThrow(/ISO/);
    const ok = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "x", createdAt: new Date(Date.now() + 60_000).toISOString() });
    expect(ok.seq).toBe(0);
  });
});
