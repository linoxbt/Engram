/** Integrity fixes: resurrection behind an unhashed flag, hostile checkpoint fields, resumed verification, frontiers. */
import { describe, expect, it } from "vitest";
import {
  ChainVerifier, ERASURE_WINDOW, buildCheckpoint, checkpointProblem, frontierAppendHex, frontierRootHex, popcount, rootHex, signCheckpoint,
  verifySpace, type Checkpoint,
} from "../src/index";
import { SPACE, TestChain, checkpointAt, keys } from "./helpers";

/** A forgotten memory whose text an attacker restored from a backup, with the forget entry flagged "pending". */
async function resurrected(after: number) {
  const chain = new TestChain();
  await chain.add({ text: "Ada shared a delivery address: 14 Palm Close, Lekki.", subject: "customer:ada" }); // 0
  const backup = structuredClone(chain.entries[0].metadata.c);
  await chain.add({ op: "forget", text: "user request", refs: { target: chain.id(0) } }); // 1
  for (let i = 0; i < after; i++) await chain.add({ text: `later ${i}` });
  const es = chain.clone();
  es[0].metadata = { ...es[0].metadata, c: backup, text: backup.text };
  es[1].metadata = { ...es[1].metadata, applied: "false" };
  return verifySpace({ space: SPACE, entries: es });
}

describe("erasure in progress", () => {
  it("is a warning only while the forget entry is among the newest entries", async () => {
    const recent = await resurrected(3);
    expect(recent.status).toBe("warning");
    expect(recent.findings.find((f) => f.rule === "content")?.severity).toBe("warning");
  });

  it("is a resurrection once the forget entry is older than the window, whatever the unhashed flag says", async () => {
    const old = await resurrected(ERASURE_WINDOW + 5);
    expect(old.status).toBe("tampered");
    expect(old.findings.find((f) => f.rule === "content")).toMatchObject({ seq: 0, severity: "critical" });
  });
});

describe("hostile checkpoint fields", () => {
  it("reports a malformed older checkpoint instead of throwing while linking", async () => {
    const k = await keys();
    const chain = new TestChain();
    for (let i = 0; i < 4; i++) await chain.add({});
    const c1 = await checkpointAt(chain.entries, 2, k.privateKey, null);
    const c2 = await checkpointAt(chain.entries, 4, k.privateKey, c1);
    const hostile = [
      { ...c1, anchor: { type: "github", repo: "x/y", commit: 5, path: "p", anchoredSeq: "000000000000" } },
      { ...c1, prevCheckpoint: 7, prevCheckpointHash: null },
      { ...c1, prevCheckpoint: null, prevCheckpointHash: { a: 1 } },
      { ...c1, anchor: { type: "github", repo: "x/y", commit: "c", path: "p", anchoredSeq: "000000000000", extra: 1 } },
      { ...c1, space: 42 },
    ] as unknown as Checkpoint[];
    for (const bad of hostile) {
      expect(checkpointProblem(bad, SPACE)).not.toBeNull();
      const r = await verifySpace({ space: SPACE, entries: chain.entries, checkpoints: [bad, c2], publicKeys: { test: k.publicKey } });
      expect(r.status).toBe("tampered");
      expect(r.findings.some((f) => f.rule === "checkpoint" && /malformed/.test(f.message))).toBe(true);
    }
    // Still valid without the hostile file, and an anchor with a null commit is well-formed.
    expect((await verifySpace({ space: SPACE, entries: chain.entries, checkpoints: [c1, c2], publicKeys: { test: k.publicKey } })).status).toBe("valid");
    expect(checkpointProblem({ ...c1, anchor: { type: "github", repo: "x/y", commit: null, path: "p", anchoredSeq: "000000000000" } }, SPACE)).toBeNull();
  });
});

describe("resumed verification", () => {
  it("checks only entries after a trusted prefix, and still catches a broken link or edited header", async () => {
    const chain = new TestChain();
    for (let i = 0; i < 10; i++) await chain.add({});
    const es = chain.clone();
    const from = { size: 6, head: es[5].metadata.hash, createdAt: es[5].metadata.h.createdAt };
    const ok = new ChainVerifier({ space: SPACE, from });
    await ok.push(es.slice(6));
    const r = await ok.finish();
    expect(r).toMatchObject({ status: "valid", entries: 10, validThrough: 9, checkpointsTotal: 0 });

    const wrongHead = new ChainVerifier({ space: SPACE, from: { ...from, head: "f".repeat(64) } });
    await wrongHead.push(es.slice(6));
    expect((await wrongHead.finish()).findings[0]).toMatchObject({ seq: 6, rule: "link" });

    es[8].metadata = { ...es[8].metadata, h: { ...es[8].metadata.h, subject: "evil" } };
    const edited = new ChainVerifier({ space: SPACE, from });
    await edited.push(es.slice(6));
    const e = await edited.finish();
    expect(e.status).toBe("tampered");
    expect(e.validThrough).toBe(7);
  });
});

describe("Merkle frontier", () => {
  it("matches a full rebuild for every size 1..70 across several incremental steps", async () => {
    const leaves = Array.from({ length: 70 }, (_, i) => (i * 7919 + 1).toString(16).padStart(64, "0"));
    for (const step of [1, 3, 5, 16, 70]) {
      let frontier: string[] = [];
      let size = 0;
      while (size < leaves.length) {
        const next = Math.min(leaves.length, size + step);
        frontier = await frontierAppendHex(frontier, size, leaves.slice(size, next));
        size = next;
        expect(frontier.length).toBe(popcount(size));
        expect(await frontierRootHex(frontier)).toBe(await rootHex(leaves.slice(0, size)));
      }
    }
    // Every size, one leaf at a time.
    let f: string[] = [];
    for (let n = 1; n <= 70; n++) {
      f = await frontierAppendHex(f, n - 1, [leaves[n - 1]]);
      expect(await frontierRootHex(f)).toBe(await rootHex(leaves.slice(0, n)));
    }
  });

  it("builds a checkpoint from an incrementally computed tree identical to one from all hashes", async () => {
    const k = await keys();
    const leaves = Array.from({ length: 11 }, (_, i) => (i + 1).toString(16).padStart(64, "a"));
    const createdAt = "2026-10-25T00:00:00.000Z";
    const full = await buildCheckpoint({ space: SPACE, hashes: leaves, prev: null, keyId: "test", createdAt });
    const tree = { size: 11, head: leaves[10], root: await frontierRootHex(await frontierAppendHex([], 0, leaves)) };
    const inc = await buildCheckpoint({ space: SPACE, tree, prev: null, keyId: "test", createdAt });
    expect(inc).toEqual(full);
    expect((await signCheckpoint(inc, k.privateKey)).sig).toBe((await signCheckpoint(full, k.privateKey)).sig);
  });
});
