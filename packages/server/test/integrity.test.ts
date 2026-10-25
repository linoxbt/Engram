/** Integrity audit fixes (engineer A): trust anchor, malformed files, keyring, alerts, incremental signer, caches. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCheckpoint, checkpointFileId, fromBase64, generateKeyPair, rootHex, runAttack, signCheckpoint, verifyProofHex, type Checkpoint, type EntryMeta,
} from "@engram/core";
import {
  anchorToGitHub, append, applyRetention, createSpace, embedDocument, forget, formatVerify, getConfig, getEntry, getSpace, keyringOf, loadChain,
  loadCheckpoints, overview, proofFor, recall, remember, resetConfig, runCheckpoint, runScheduledCheckpoints, runScheduledReflect, runSentinel,
  scheduleBudgetMs, setConfig, subjectsOverview, sweepPendingRelate, syncChainIndex, updateSettings, verifyAnchors, verifyAndRecord,
  verifyStoredSpace, verifyTool, DEFAULT_KEY_ID, type Backend, type Ctx, type IntegrityStatus, type SpaceInfo,
} from "../src/index";
import { setup } from "./helpers";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; resetConfig(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const bucket = () => getConfig().appwrite.checkpointsBucket;
const fresh = async (b: Backend, key: string) => (await getSpace(b, key))!;
const enc = (o: unknown) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));
let counter = 0;
async function fill(ctx: Ctx, n: number) {
  for (let i = 0; i < n; i++) await append(ctx, { op: "remember", kind: "fact", subject: null, text: `fact ${counter++}` });
}
const hashesOf = async (b: Backend, key: string) => (await loadChain(b, key)).map((e) => e.metadata.hash);
const quietErrors = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

describe("server trust anchor (latestCheckpoint)", () => {
  it("deleting every checkpoint file and rewriting the chain is caught, and the signer refuses to sign the forgery", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 6);
    expect((await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey })).created).toBe(true);
    expect((await fresh(b, key)).settings.latestCheckpoint?.size).toBe(6);

    // The attacker has database and storage access: every checkpoint file and lock goes, the whole chain is rewritten
    // with consistent hashes, and a stale lock on the start of the chain invites a reclaim.
    for (const prefix of [`cp_${key}_`, `cpl_${key}_`]) for (const f of await b.files.list(bucket(), prefix)) await b.files.delete(bucket(), f.fileId);
    const forged = await runAttack("rewrite-suffix", await loadChain(b, key, { withVectors: true }), { seq: 0 });
    for (const e of forged.entries) await b.vectors.update("memories", e.$id, { metadata: e.metadata });
    await fill(ctx, 1); // writers keep appending to the forged head, so the next scheduled run has something to sign
    await b.files.put(bucket(), `cpl_${key}_genesis`, "x", enc({ at: new Date(Date.now() - 3_600_000).toISOString(), prev: null, token: "dead" }), []);
    quietErrors();
    const notify = vi.spyOn(b.jobs, "notifyTamper");

    const run = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(run).toMatchObject({ created: false, refused: true });
    expect(run.reason).toMatch(/deleted or rolled back/);
    expect(await loadCheckpoints(b, key)).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    const after = await fresh(b, key);
    expect(after.settings.integrity?.status).toBe("tampered");
    expect(after.settings.latestCheckpoint?.size).toBe(6);

    const report = await verifyStoredSpace(b, after);
    expect(report.status).toBe("tampered");
    expect(report.findings.map((f) => f.rule)).toContain("rollback");

    // Clearing the badge (the integrity store is reachable with database access) does not make the signer sign it.
    await updateSettings(b, key, { integrity: null });
    const again = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(again).toMatchObject({ created: false, refused: true });
    expect(await loadCheckpoints(b, key)).toHaveLength(0);
  });

  it("a replaced newest checkpoint does not match the recorded one", async () => {
    const { b, ctx, keys } = await setup();
    await fill(ctx, 3);
    const first = await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    const id = checkpointFileId(first.checkpoint!);
    // Re-signed by nobody: a copy with another root fails the pointer check before anything else.
    await b.files.delete(bucket(), id);
    await b.files.put(bucket(), id, `${id}.json`, enc({ ...first.checkpoint!, root: "e".repeat(64) }), []);
    await fill(ctx, 1);
    quietErrors();
    const run = await runCheckpoint(b, await fresh(b, ctx.space.key), { privateKey: keys.privateKey });
    expect(run.refused).toBe(true);
    expect(run.reason).toMatch(/not the one this space's signer recorded/);
  });

  it("a successor claim keeps a reclaimed run from forking the chain, and the loser finishes the winner's work", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 4);
    const cp1 = (await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey })).checkpoint!;
    await fill(ctx, 3);
    // A run claimed cp1's successor (size 6) and died before writing the file.
    const dead = await signCheckpoint(await buildCheckpoint({ space: key, hashes: (await hashesOf(b, key)).slice(0, 6), prev: cp1, keyId: "test" }), keys.privateKey);
    await b.files.put(bucket(), `cpl_${key}_${cp1.seq}_c`, "claim", enc(dead), []);

    const loser = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(loser.created).toBe(false);
    expect(loser.checkpoint?.seq).toBe(dead.seq);
    expect((await loadCheckpoints(b, key)).map((c) => Number(c.size))).toEqual([4, 6]);
    expect((await fresh(b, key)).settings.latestCheckpoint?.size).toBe(6);

    const next = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(next.created).toBe(true);
    expect(next.checkpoint!.prevCheckpoint).toBe(checkpointFileId(dead));
    expect((await verifyStoredSpace(b, await fresh(b, key))).status).toBe("valid");
  });
});

describe("malformed checkpoint files", () => {
  it("a malformed newest file is reported and the signer refuses", async () => {
    const { b, ctx, keys } = await setup();
    await fill(ctx, 3);
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    await fill(ctx, 2);
    const id = `cp_${ctx.space.key}_000000000004`;
    await b.files.put(bucket(), id, `${id}.json`, enc("{not json"), []);
    quietErrors();
    const run = await runCheckpoint(b, await fresh(b, ctx.space.key), { privateKey: keys.privateKey });
    expect(run.refused).toBe(true);
    expect(run.reason).toMatch(/malformed/);
    const r = await verifyStoredSpace(b, await fresh(b, ctx.space.key));
    expect(r.status).toBe("tampered");
    expect(r.findings.some((f) => f.rule === "checkpoint" && /malformed/.test(f.message))).toBe(true);
  });

  it("a malformed older file reaches the verifier, and the signer stays refused while it is there", async () => {
    const { b, ctx, keys } = await setup();
    await fill(ctx, 2);
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    await fill(ctx, 2);
    await runCheckpoint(b, await fresh(b, ctx.space.key), { privateKey: keys.privateKey });
    const id = `cp_${ctx.space.key}_000000000002`;
    await b.files.put(bucket(), id, `${id}.json`, enc({ v: "1", size: 3 }), []);
    expect(await loadCheckpoints(b, ctx.space.key)).toHaveLength(2);
    const r = await verifyAndRecord(b, await fresh(b, ctx.space.key));
    expect(r.status).toBe("tampered");
    expect(r.findings.find((f) => f.severity === "critical")?.message).toMatch(/malformed/);
    await fill(ctx, 1);
    const run = await runCheckpoint(b, await fresh(b, ctx.space.key), { privateKey: keys.privateKey });
    expect(run).toMatchObject({ created: false, refused: true });
  });
});

describe("recorded tampering", () => {
  it("a stale tampered badge is re-checked in full, and signing resumes once the chain verifies", async () => {
    const { b, ctx, keys } = await setup();
    await fill(ctx, 3);
    await updateSettings(b, ctx.space.key, { integrity: { status: "tampered", validThrough: 0, entries: 3, findings: 1, critical: 1, checkedAt: new Date().toISOString(), firstFinding: "old" } });
    const run = await runCheckpoint(b, await fresh(b, ctx.space.key), { privateKey: keys.privateKey });
    expect(run.created).toBe(true);
    expect((await fresh(b, ctx.space.key)).settings.integrity?.status).toBe("valid");
  });
});

describe("checkpoint keyring on the server", () => {
  it("verifies across a key rotation, and the signer fails closed on a predecessor it cannot check", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 3);
    expect((await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey })).checkpoint!.keyId).toBe("test");
    const next = await generateKeyPair();
    await fill(ctx, 2);
    quietErrors();

    // Rotated without listing the old public key: nothing is signed, and nothing is blamed on the data.
    setConfig({ checkpoint: { privateKey: next.privateKey, publicKey: next.publicKey, keyId: "test-2" } });
    const blocked = await runCheckpoint(b, await fresh(b, key), { privateKey: next.privateKey });
    expect(blocked).toMatchObject({ created: false, refused: true });
    expect(blocked.reason).toMatch(/CP_PUBLIC_KEYS/);
    expect((await fresh(b, key)).settings.integrity?.status).not.toBe("tampered");
    expect((await verifyStoredSpace(b, await fresh(b, key))).findings[0].message).toMatch(/unknown key \(test\)/);

    // A configured key that is not the signer's own: refuse rather than sign checkpoints nobody can verify.
    const other = await generateKeyPair();
    setConfig({ checkpoint: { privateKey: next.privateKey, publicKey: other.publicKey, keyId: "test-2", publicKeys: { test: keys.publicKey } } });
    expect((await runCheckpoint(b, await fresh(b, key), { privateKey: next.privateKey })).reason).toMatch(/does not match/);

    // The runbook: the old key stays in the keyring, the new key signs.
    setConfig({ checkpoint: { privateKey: next.privateKey, publicKey: next.publicKey, keyId: "test-2", publicKeys: { test: keys.publicKey } } });
    const rotated = await runCheckpoint(b, await fresh(b, key), { privateKey: next.privateKey });
    expect(rotated.created).toBe(true);
    expect(rotated.checkpoint!.keyId).toBe("test-2");
    const report = await verifyStoredSpace(b, await fresh(b, key));
    expect(report).toMatchObject({ status: "valid", checkpointsValid: 2 });
    const proof = await proofFor(b, await fresh(b, key), `m_${key}_000000000001`);
    expect(proof.publicKey).toBe(next.publicKey);
  });

  it("reads CP_PUBLIC_KEYS plus the legacy key, and defaults the key ID to the keygen format", () => {
    const [h1, h2, h3] = ["1", "2", "3"].map((c) => c.repeat(64));
    process.env = { ...ENV, CP_PUBLIC_KEYS: `cp-a:${h1}, cp-b:${h2}`, NEXT_PUBLIC_CP_PUBLIC_KEY: h3, CP_KEY_ID: "cp-c" };
    resetConfig();
    expect(keyringOf(getConfig())).toEqual({ "cp-a": h1, "cp-b": h2, "cp-c": h3 });
    process.env = { ...ENV, CP_KEY_ID: "", NEXT_PUBLIC_CP_KEY_ID: "" };
    resetConfig();
    expect(getConfig().checkpoint.keyId).toBe(DEFAULT_KEY_ID);
    expect(DEFAULT_KEY_ID).toMatch(/^engram-cp-\d{4}-\d{2}$/);
  });
});

describe("configuration", () => {
  it("an unknown ENGRAM_BACKEND fails loudly", () => {
    process.env = { ...ENV, ENGRAM_BACKEND: "apprwite" };
    resetConfig();
    expect(getConfig().configError).toMatch(/ENGRAM_BACKEND/);
  });

  it("never points alert links at localhost in production", () => {
    process.env = { ...ENV, NODE_ENV: "production", ENGRAM_BACKEND: "local", NEXT_PUBLIC_APP_URL: "", APP_URL: "", NETLIFY: "", URL: "" };
    resetConfig();
    expect(getConfig().appUrl).toBeNull();
    process.env = { ...process.env, NETLIFY: "true", URL: "https://engram.example" };
    resetConfig();
    expect(getConfig().appUrl).toBe("https://engram.example");
    process.env = { ...ENV, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "", APP_URL: "", NETLIFY: "" };
    resetConfig();
    expect(getConfig().appUrl).toBe("http://localhost:3000");
  });

  it("caps scheduled budgets below the Function timeout", () => {
    expect(scheduleBudgetMs(undefined)).toBe(240_000);
    expect(scheduleBudgetMs("abc")).toBe(240_000);
    expect(scheduleBudgetMs("1000")).toBe(1000);
    expect(scheduleBudgetMs(999_999)).toBe(270_000);
  });
});

describe("tamper alerts", () => {
  it("alerts once per incident, whoever records it first", async () => {
    const { b, ctx } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 3);
    const notify = vi.spyOn(b.jobs, "notifyTamper").mockResolvedValue();
    const id = `m_${key}_000000000001`;
    const original = (await getEntry(b, id))!.metadata;
    await b.vectors.update<EntryMeta>("memories", id, { metadata: { ...original, c: { ...original.c, text: "evil" }, text: "evil" } });

    // A person pressing Verify records "tampered" first; the email goes out then, and the sentinel does not repeat it.
    await verifyAndRecord(b, await fresh(b, key));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ spaceKey: key, message: expect.stringMatching(/#1/) });
    await runSentinel(b, { spaces: [await fresh(b, key)] });
    expect(notify).toHaveBeenCalledTimes(1);
    const recorded = (await fresh(b, key)).settings.integrity as IntegrityStatus & { alertedAt?: string };
    expect(recorded.alertedAt).toBeTruthy();

    // Something recorded "tampered" without alerting (an older writer, a failed email): the sentinel alerts.
    await updateSettings(b, key, { integrity: { ...recorded, alertedAt: null } as IntegrityStatus });
    await runSentinel(b, { spaces: [await fresh(b, key)] });
    expect(notify).toHaveBeenCalledTimes(2);

    // Restored, then tampered again: a new incident.
    await b.vectors.update<EntryMeta>("memories", id, { metadata: original });
    expect((await verifyAndRecord(b, await fresh(b, key))).status).toBe("valid");
    await b.vectors.update<EntryMeta>("memories", id, { metadata: { ...original, c: { ...original.c, text: "evil again" }, text: "evil again" } });
    await verifyAndRecord(b, await fresh(b, key));
    expect(notify).toHaveBeenCalledTimes(3);
  });
});

describe("verify tool", () => {
  it("reports a warning as a warning and prints the real first warning", async () => {
    const { b, ctx } = await setup();
    await fill(ctx, 2);
    const id = `m_${ctx.space.key}_000000000000`;
    const m = (await getEntry(b, id))!.metadata;
    await b.vectors.update<EntryMeta>("memories", id, { metadata: { ...m, d: { ...m.d, status: "superseded" }, status: "superseded" } });
    const r = await verifyTool(ctx, {});
    expect(r.status).toBe("warning");
    const text = formatVerify(r);
    expect(text).toMatch(/^Verified with warnings/);
    expect(text).toContain(r.findings.find((f) => f.severity === "warning")!.message);
    expect(text).not.toMatch(/derived fields disagree/);
  });
});

describe("incremental signer", () => {
  it("signs the same roots as a full rebuild for sizes up to 70, reading only new entries", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    let size = 0;
    for (const step of [1, 2, 3, 5, 8, 1, 13, 7, 30]) {
      await fill(ctx, step);
      size += step;
      const query = vi.spyOn(b.vectors, "query");
      const run = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
      expect(run.created).toBe(true);
      const fullReads = query.mock.calls.filter(([coll, q]) => coll === "memories" && q.limit === 500 && !q.filters?.some((f) => f.op === "gte"));
      query.mockRestore();
      // The first checkpoint has nothing to resume from; every later one reads only entries from the previous head on.
      expect(fullReads.length).toBe(size === step ? 1 : 0);
      expect(Number(run.checkpoint!.size)).toBe(size);
      expect(run.checkpoint!.root).toBe(await rootHex(await hashesOf(b, key)));
    }
    expect((await verifyStoredSpace(b, await fresh(b, key))).status).toBe("valid");
  });

  it("falls back to a full rebuild without a usable frontier", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 5);
    const cp = (await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey })).checkpoint!;
    const sidecar = `cpl_${key}_${cp.seq}_f`;
    await b.files.delete(bucket(), sidecar);
    await b.files.put(bucket(), sidecar, "x", enc({ v: "1", space: key, size: cp.size, root: cp.root, frontier: ["a".repeat(64), "b".repeat(64)] }), []);
    await fill(ctx, 4);
    const run = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(run.checkpoint!.root).toBe(await rootHex(await hashesOf(b, key)));
  });

  it("refuses new entries that do not verify and a rewritten last signed entry", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 4);
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    await fill(ctx, 3);
    quietErrors();
    const id = `m_${key}_000000000005`;
    const m = (await getEntry(b, id))!.metadata;
    await b.vectors.update<EntryMeta>("memories", id, { metadata: { ...m, h: { ...m.h, subject: "evil" } } });
    const run = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(run.refused).toBe(true);
    await b.vectors.update<EntryMeta>("memories", id, { metadata: m });
    await updateSettings(b, key, { integrity: null });

    const rewritten = await runAttack("rewrite-suffix", await loadChain(b, key, { withVectors: true }), { seq: 3 });
    for (const e of rewritten.entries.slice(3)) await b.vectors.update("memories", e.$id, { metadata: e.metadata });
    const second = await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    expect(second.refused).toBe(true);
    expect(second.reason).toMatch(/Entry #3 no longer matches/);
  });
});

describe("GitHub anchors", () => {
  it("never signs an empty commit, and the sentinel compares published roots", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    setConfig({ anchor: { token: "t", repo: "owner/anchors" } });
    await updateSettings(b, key, { anchoring: true });
    const published = new Map<string, string>();
    let sha: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") {
        const path = url.split("/contents/")[1];
        published.set(path, new TextDecoder().decode(fromBase64(JSON.parse(init.body!).content)));
        return new Response(JSON.stringify(sha ? { commit: { sha } } : {}), { status: 201 });
      }
      const path = url.split("/").slice(-3).join("/");
      const body = published.get(path);
      return body ? new Response(body, { status: 200 }) : new Response("not found", { status: 404 });
    }));
    await fill(ctx, 2);
    await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    await fill(ctx, 2);
    const second = (await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey })).checkpoint!;
    expect(second.anchor).toMatchObject({ type: "github", commit: null, anchoredSeq: "000000000001" });

    const ok = await verifyStoredSpace(b, await fresh(b, key), "standard", { anchors: true });
    expect(ok.status).toBe("valid");

    // The published file disagrees with the stored checkpoint it anchors.
    const path = `anchors/${key}/000000000001.json`;
    published.set(path, JSON.stringify({ ...JSON.parse(published.get(path)!), root: "d".repeat(64) }));
    const bad = await verifyStoredSpace(b, await fresh(b, key), "standard", { anchors: true });
    expect(bad.status).toBe("tampered");
    expect(bad.findings.find((f) => f.rule === "anchor")?.severity).toBe("critical");

    // Unreachable: a warning, not a verdict.
    const cps = await loadCheckpoints(b, key);
    const down = await verifyAnchors(cps, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(down).toEqual([expect.objectContaining({ rule: "anchor", severity: "warning" })]);

    sha = "a".repeat(40);
    expect((await anchorToGitHub(getConfig(), cps[0]))!.commit).toBe(sha);
  });
});

describe("authoritative as-of", () => {
  it("returns the covering checkpoint and refuses a history that does not verify", async () => {
    const { b, ctx, keys } = await setup();
    await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" }, { createdAt: "2026-10-19T09:01:00.000Z" });
    await remember(ctx, { text: "Ada prefers email over phone calls.", subject: "customer:ada" }, { createdAt: "2026-10-19T10:00:00.000Z" });
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    await remember(ctx, { text: "Ada downgraded from the Pro plan to Basic on 22 October.", subject: "customer:ada" }, { createdAt: "2026-10-22T11:15:00.000Z" });
    const space = await fresh(b, ctx.space.key);
    const sctx = { ...ctx, space };
    const r = await recall(sctx, { query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00.000Z", verify: true });
    expect(r.mode).toBe("as-of-verified");
    expect(r.replayed).toBe(2);
    expect(r.checkpoint).toMatchObject({ size: 2 });
    expect(r.integrity?.status).toBe("valid");
    expect(r.memories.map((m) => m.text)).toContain("Ada is on the Pro plan, billed monthly.");
    // Newer than every checkpoint: answered, with no covering checkpoint.
    expect((await recall(sctx, { query: "What plan is Ada on?", asOf: "2026-10-23T00:00:00.000Z", verify: true })).checkpoint).toBeNull();

    const id = `m_${space.key}_000000000000`;
    const m = (await getEntry(b, id))!.metadata;
    await b.vectors.update<EntryMeta>("memories", id, { metadata: { ...m, h: { ...m.h, importance: "09" } } });
    await expect(recall(sctx, { query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00.000Z", verify: true })).rejects.toThrow(/does not verify/);
  });
});

describe("cached reads", () => {
  it("keeps the chain index identical to a full read while memories are superseded, contradicted and forgotten", async () => {
    const { b, ctx, drain } = await setup();
    const key = ctx.space.key;
    const full = async () => (await loadChain(b, key)).map((e) => ({ id: e.$id, op: e.metadata.op, status: e.metadata.d.status, c: [...e.metadata.d.contradictedBy].sort(), subject: e.metadata.subject }));
    const cached = async () => (await syncChainIndex(b, key)).rows.map((r) => ({ id: r.id, op: r.op, status: r.status, c: [...r.contradictedBy].sort(), subject: r.subject }));
    const a = await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    const c = await remember(ctx, { text: "Kestrel Foods pays on time.", subject: "customer:kestrel" });
    expect(await cached()).toEqual(await full());
    const query = vi.spyOn(b.vectors, "query");
    await remember(ctx, { text: "Ada moved to the Basic plan.", subject: "customer:ada" }, { relations: [{ id: a.id, relation: "supersedes", confidence: 1, reason: "later" }] });
    await remember(ctx, { text: "Kestrel Foods is two months late.", subject: "customer:kestrel" }, { relations: [{ id: c.id, relation: "contradicts", confidence: 1, reason: "disagree" }] });
    expect(await cached()).toEqual(await full());
    await forget(ctx, { id: c.id, reason: "erasure requested" });
    await drain();
    expect(await cached()).toEqual(await full());
    const fullReads = query.mock.calls.filter(([coll, q]) => coll === "memories" && q.limit === 500 && !q.filters?.some((f) => f.op === "gte"));
    // Only the loadChain calls made by full() above; the index itself never paged through the chain again.
    expect(fullReads.length).toBe(3);
    query.mockRestore();

    const o = await overview({ ...ctx, space: await fresh(b, key) });
    expect(o.stats).toMatchObject({ entries: 5, memories: 4, active: 2, superseded: 1, forgotten: 1, conflicts: 0, forgets: 1 });
    // Same output as the route's previous full read.
    const chain = await loadChain(b, key);
    const counts = new Map<string, number>();
    for (const e of chain) if (e.metadata.subject) counts.set(e.metadata.subject, (counts.get(e.metadata.subject) ?? 0) + 1);
    expect(await subjectsOverview(ctx)).toEqual({
      subjects: [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([subject, count]) => ({ subject, count })),
      span: { first: chain[0].metadata.createdAt, last: chain[chain.length - 1].metadata.createdAt },
      ticks: chain.map((e) => ({ seq: Number(e.metadata.seq), op: e.metadata.op, at: e.metadata.createdAt, superseding: e.metadata.h.refs.supersedes.length > 0, subject: e.metadata.subject })),
    });
  });

  it("proofs reuse cached leaf hashes and extend them for a newer checkpoint", async () => {
    const { b, ctx, keys } = await setup();
    const key = ctx.space.key;
    await fill(ctx, 5);
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    const check = async (seq: number) => {
      const p = await proofFor(b, await fresh(b, key), `m_${key}_${String(seq).padStart(12, "0")}`);
      expect(await verifyProofHex(p.leaf, p.index, Number(p.checkpoint.size), p.path, p.checkpoint.root)).toBe(true);
    };
    await check(2);
    const query = vi.spyOn(b.vectors, "query");
    await check(4);
    expect(query.mock.calls.filter(([coll]) => coll === "memories")).toHaveLength(0);
    await fill(ctx, 3);
    await runCheckpoint(b, await fresh(b, key), { privateKey: keys.privateKey });
    query.mockClear();
    await check(7);
    expect(query.mock.calls.filter(([coll, q]) => coll === "memories" && !q.filters?.some((f) => f.op === "gte"))).toHaveLength(0);
  });
});

describe("pending work sweep", () => {
  it("the sentinel lands an erasure whose task died, so forgotten text does not linger in an idle space", async () => {
    const { b, ctx } = await setup();
    const key = ctx.space.key;
    const x = await remember(ctx, { text: "Ada shared a delivery address: 14 Palm Close, Lekki.", subject: "customer:ada" });
    const { metadata: before, embeddings: vector } = (await b.vectors.get<EntryMeta>("memories", x.id))!;
    const f = await forget(ctx, { id: x.id, reason: "erasure requested" });
    // The forget entry committed, but its neighbour update (the erasure) never ran: the target is as it was.
    await b.vectors.update<EntryMeta>("memories", x.id, { metadata: before, embeddings: vector });
    const fm = (await getEntry(b, f.forgetEntryId))!.metadata;
    await b.vectors.update<EntryMeta>("memories", f.forgetEntryId, { metadata: { ...fm, applied: "false" } });
    expect((await verifyStoredSpace(b, await fresh(b, key))).status).toBe("warning");
    const { results } = await runSentinel(b, { spaces: [await fresh(b, key)] });
    expect(results[0]).toMatchObject({ status: "valid", applied: 1 });
    expect((await getEntry(b, x.id))!.metadata.c.text).toBeNull();
  });

  it("re-classifies writes whose background contradiction check never reported back", async () => {
    const { b, ctx } = await setup();
    const old = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const t1 = "Ada is on the Pro plan, billed monthly.", t2 = "Ada is on the Pro plan, billed monthly now.";
    await append(ctx, { op: "remember", kind: "fact", subject: "customer:ada", text: t1, vector: await embedDocument(ctx, t1), createdAt: old(3) });
    const p = await append(ctx, { op: "remember", kind: "fact", subject: "customer:ada", text: t2, vector: await embedDocument(ctx, t2), createdAt: old(2), relateStatus: "pending" });
    expect(await sweepPendingRelate(b, await fresh(b, ctx.space.key))).toBe(1);
    expect((await getEntry(b, p.id))!.metadata.d.relateStatus).toBe("done");
    expect(await sweepPendingRelate(b, await fresh(b, ctx.space.key))).toBe(0);
  });

  it("retention stops between items once the budget is spent", async () => {
    const { b, ctx } = await setup();
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    for (let i = 0; i < 3; i++) await append(ctx, { op: "remember", kind: "fact", subject: null, text: `old fact ${i}`, createdAt: at });
    await updateSettings(b, ctx.space.key, { retentionDays: 1 });
    const space = await fresh(b, ctx.space.key);
    expect(await applyRetention(b, space, Date.now() - 1)).toBe(0);
    expect(await applyRetention(b, space)).toBe(3);
  });
});

describe("scheduled Functions", () => {
  it("checkpoints least recently checkpointed spaces first, reports skipped ones and failures", async () => {
    const { b, user, keys } = await setup();
    const spaces: SpaceInfo[] = [];
    for (let i = 0; i < 3; i++) spaces.push(await createSpace(b, { name: `S${i}`, ownerId: user.id }));
    const ctxOf = async (k: string): Promise<Ctx> => ({ b, cfg: getConfig(), space: await fresh(b, k), actor: "system:test", actorName: "test", scopes: ["remember"], defer: () => undefined });
    for (const s of spaces) await fill(await ctxOf(s.key), 1);
    // S2 was checkpointed before S1; S0 never.
    await runCheckpoint(b, await fresh(b, spaces[2].key), { privateKey: keys.privateKey });
    await new Promise((r) => setTimeout(r, 5));
    await runCheckpoint(b, await fresh(b, spaces[1].key), { privateKey: keys.privateKey });
    for (const s of spaces) await fill(await ctxOf(s.key), 1);
    const list = await Promise.all(spaces.map((s) => fresh(b, s.key)));
    const all = await runScheduledCheckpoints(b, list, { privateKey: keys.privateKey, budgetMs: 60_000 });
    expect(all.results.map((r) => r.space)).toEqual([spaces[0].key, spaces[2].key, spaces[1].key]);
    expect(all.results.every((r) => r.status === "created")).toBe(true);

    const none = await runScheduledCheckpoints(b, list, { privateKey: keys.privateKey, budgetMs: 0 });
    expect(none.skipped).toHaveLength(3);

    quietErrors();
    const head = b.vectors.query.bind(b.vectors);
    b.vectors.query = (async (coll, q) => {
      if (q.filters?.some((f) => f.op === "eq" && f.values.includes(spaces[0].key))) throw new Error("boom");
      return head(coll, q);
    }) as typeof b.vectors.query;
    const failed = await runScheduledCheckpoints(b, list, { privateKey: keys.privateKey, budgetMs: 60_000 });
    expect(failed.results.find((r) => r.space === spaces[0].key)?.status).toBe("error");
  });

  it("reflect reports skipped spaces and treats concepts it cannot summarise as nothing to do", async () => {
    const { b, ctx } = await setup();
    const space = await fresh(b, ctx.space.key);
    expect((await runScheduledReflect(b, [space], { budgetMs: 0 })).skipped).toEqual([space.key]);
    const r = await runScheduledReflect(b, [space], { budgetMs: 60_000, concept: "c_missing" });
    expect(r.errors).toEqual([]);
  });
});

export type { Checkpoint };
