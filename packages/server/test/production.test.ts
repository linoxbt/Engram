/** Production-readiness: cost bounds on scheduled work and races found in the second audit. */
import { describe, expect, it, vi } from "vitest";
import { buildCheckpoint, checkpointFileId, signCheckpoint } from "@engram/core";
import { append, getConfig, getSpace, latestCheckpoint, listAllSpaces, loadChain, loadCheckpoints, runCheckpoint, verifyStoredSpace } from "../src/index";
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
