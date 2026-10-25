/**
 * Live integration suite for the Appwrite adapter. Skipped unless APPWRITE_TEST_ENDPOINT, APPWRITE_TEST_PROJECT and
 * APPWRITE_TEST_KEY are set (the `appwrite-live` provisioning step sets them from the build's Appwrite variables).
 *
 * It writes into the real collections, so every document and file uses the reserved test space key
 * (APPWRITE_TEST_SPACE, default "test0000": the 0 can never come out of the base32 space key generator), carries
 * no team permissions, and is deleted afterwards, including leftovers from an earlier interrupted run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cosine, entryId, tombstoneVector } from "@engram/core";
import { createAppwriteBackend } from "../src/backend/appwrite";
import type { Backend } from "../src/backend/types";
import { getConfig } from "../src/config";
import { isConflict } from "../src/errors";

const endpoint = process.env.APPWRITE_TEST_ENDPOINT, project = process.env.APPWRITE_TEST_PROJECT, key = process.env.APPWRITE_TEST_KEY;
const SPACE = process.env.APPWRITE_TEST_SPACE ?? "test0000";
const live = !!(endpoint && project && key);
if (live && !/^[a-z0-9]{8}$/.test(SPACE)) throw new Error("APPWRITE_TEST_SPACE must be 8 characters of [a-z0-9]");

// Sequence numbers far beyond any real chain, randomised per run so parallel runs do not collide.
const base = 900_000_000_000 + Math.floor(Math.random() * 90_000_000) * 1000;
const id = (n: number) => entryId(SPACE, base + n);
const DIM = 768;
const unit = (i: number) => { const v = new Array<number>(DIM).fill(0); v[i] = 1; return v; };
const meta = (extra: Record<string, string> = {}) => ({ space: SPACE, test: "appwrite-live", ...extra });

describe.skipIf(!live)("Appwrite adapter, live", () => {
  let b: Backend;
  const bucket = process.env.APPWRITE_TEST_BUCKET ?? process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints";
  const fileId = `tst_${SPACE}_${base}`;

  async function sweep() {
    for (let i = 0; i < 10; i++) {
      const docs = await b.vectors.query("memories", { filters: [{ op: "eq", path: "metadata.space", values: [SPACE] }], limit: 100, withVectors: false });
      if (!docs.length) break;
      await Promise.all(docs.map((d) => b.vectors.delete("memories", d.$id)));
    }
    for (const f of await b.files.list(bucket, `tst_${SPACE}_`)) await b.files.delete(bucket, f.fileId);
  }

  beforeAll(async () => {
    const cfg = getConfig();
    b = createAppwriteBackend({ ...cfg, appwrite: { ...cfg.appwrite, endpoint: endpoint!, projectId: project!, apiKey: key!, databaseId: process.env.APPWRITE_TEST_DB ?? cfg.appwrite.databaseId } });
    // Leftovers from an interrupted run. A failure here (no connection, missing scope) is reported by the tests.
    await sweep().catch((e) => console.warn("[appwrite-live] initial sweep failed:", e instanceof Error ? e.message : e));
  }, 120_000);
  afterAll(async () => { if (b) await sweep(); }, 120_000);

  it("create-first: a second create with the same ID is a conflict and does not overwrite", async () => {
    await b.vectors.create("memories", id(1), { embeddings: unit(1), metadata: meta({ who: "first" }) }, []);
    const second = await b.vectors.create("memories", id(1), { embeddings: unit(2), metadata: meta({ who: "second" }) }, []).then(() => "landed", (e) => (isConflict(e) ? "conflict" : String(e)));
    expect(second).toBe("conflict");
    expect((await b.vectors.get<{ who: string }>("memories", id(1)))?.metadata.who).toBe("first");
  });

  it("compare-and-swap: of three writers racing on one read, exactly one lands; a later stale write is rejected", async () => {
    await b.vectors.create("memories", id(2), { embeddings: unit(1), metadata: meta({ n: "0" }) }, []);
    const read = (await b.vectors.get("memories", id(2)))!;
    const attempts = await Promise.allSettled([1, 2, 3].map((n) => b.vectors.update("memories", id(2), { metadata: meta({ n: String(n) }) }, undefined, { ifUpdatedAt: read.$updatedAt })));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "rejected" && isConflict(a.reason))).toHaveLength(2);
    const stale = await b.vectors.update("memories", id(2), { metadata: meta({ n: "late" }) }, undefined, { ifUpdatedAt: read.$updatedAt }).then(() => "landed", (e) => (isConflict(e) ? "rejected" : String(e)));
    expect(stale).toBe("rejected");
  });

  it("a conditional bulk update that includes embeddings replaces the vector (the forget path)", async () => {
    await b.vectors.create("memories", id(3), { embeddings: unit(5), metadata: meta({ text: "to be erased" }) }, []);
    const read = (await b.vectors.get("memories", id(3)))!;
    await b.vectors.update("memories", id(3), { metadata: meta({ text: "" }), embeddings: tombstoneVector(DIM) }, undefined, { ifUpdatedAt: read.$updatedAt });
    const [after] = await b.vectors.query<{ text: string }>("memories", { filters: [{ op: "eq", path: "$id", values: [id(3)] }], limit: 1 });
    expect(after.metadata.text).toBe("");
    expect(after.embeddings).toBeDefined();
    expect(cosine(after.embeddings!, tombstoneVector(DIM))).toBeGreaterThan(0.9999);
  });

  it("a batch applied through transact() lands (transactions or the conditional fallback)", async () => {
    await b.vectors.create("memories", id(4), { embeddings: unit(1), metadata: meta({ n: "0" }) }, []);
    const read = (await b.vectors.get("memories", id(4)))!;
    await b.vectors.transact([
      { action: "update", coll: "memories", id: id(4), data: { metadata: meta({ n: "1" }) }, ifUpdatedAt: read.$updatedAt },
      { action: "create", coll: "memories", id: id(5), data: { embeddings: unit(2), metadata: meta({ n: "new" }) }, perms: [] },
    ]);
    expect((await b.vectors.get<{ n: string }>("memories", id(4)))?.metadata.n).toBe("1");
    expect((await b.vectors.get<{ n: string }>("memories", id(5)))?.metadata.n).toBe("new");
  });

  it("files: create-first with a duplicate file ID is a conflict; the prefix listing finds the file", async () => {
    await b.files.put(bucket, fileId, `${fileId}.json`, new TextEncoder().encode('{"v":"1"}'), []);
    const dup = await b.files.put(bucket, fileId, `${fileId}.json`, new TextEncoder().encode('{"v":"2"}'), []).then(() => "landed", (e) => (isConflict(e) ? "conflict" : String(e)));
    expect(dup).toBe("conflict");
    expect(new TextDecoder().decode((await b.files.get(bucket, fileId))!)).toBe('{"v":"1"}');
    expect((await b.files.list(bucket, `tst_${SPACE}_`)).map((f) => f.fileId)).toContain(fileId);
  });
});
