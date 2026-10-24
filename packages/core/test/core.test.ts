import { describe, expect, it } from "vitest";
import {
  canonical, contentHash, embHash, genesis, headerHash, quantize, rootHex, proofHex, verifyProofHex, sha256Hex,
  buildCheckpoint, signCheckpoint, verifyCheckpointSig, generateKeyPair, publicKeyFromPrivate, checkpointHash,
  seqStr, entryId, seqOf, score, iso, count8, mmr, rrfFuse, scoreCandidate, keywordTerms, validAt, validSetAt,
  replay, isTombstone, tombstoneVector,
} from "../src/index";
import { SPACE, TestChain } from "./helpers";

describe("canonical", () => {
  it("is independent of key order", () => {
    expect(canonical({ b: "1", a: { d: "x", c: null } })).toBe(canonical({ a: { c: null, d: "x" }, b: "1" }));
  });
  it("normalises unicode to NFC", () => {
    expect(canonical("é")).toBe(canonical("é"));
  });
  it("rejects numbers", () => {
    expect(() => canonical({ a: 1 })).toThrow(/numbers/);
  });
  it("drops undefined keys and keeps null", () => {
    expect(canonical({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe("encoders", () => {
  it("pads fixed widths", () => {
    expect(seqStr(42)).toBe("000000000042");
    expect(entryId(SPACE, 42)).toBe("m_k7m2q9xa_000000000042");
    expect(entryId(SPACE, 42).length).toBe(23);
    expect(seqOf("m_k7m2q9xa_000000000042")).toBe(42);
    expect(score(7.4)).toBe("07");
    expect(score(99)).toBe("10");
    expect(count8(13)).toBe("00000013");
    expect(iso(0)).toHaveLength(24);
  });
});

describe("hashes (fixed test vectors)", () => {
  it("are stable across platforms", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await genesis(SPACE)).toBe(await sha256Hex("engram:genesis:v1:k7m2q9xa"));
    expect(await contentHash("c2FsdA==", "Ada is on the Pro plan.")).toBe(await sha256Hex("engram:content:v1:c2FsdA==:Ada is on the Pro plan."));
  });
  it("embHash survives a float32 round trip after quantizing", async () => {
    const v = quantize([0.0123456789, -0.5, 0.33333333, 0.9999999]);
    const f32 = Array.from(new Float32Array(v));
    expect(await embHash(quantize(f32))).toBe(await embHash(v));
  });
  it("header hash changes with any header field", async () => {
    const c = new TestChain();
    const e = await c.add({ text: "x" });
    const h2 = { ...e.metadata.h, importance: "09" };
    expect(await headerHash(h2)).not.toBe(e.metadata.hash);
  });
});

describe("merkle", () => {
  it("proves every index for sizes 1 to 70", async () => {
    for (let n = 1; n <= 70; n++) {
      const leaves = await Promise.all(Array.from({ length: n }, (_, i) => sha256Hex(`leaf ${i}`)));
      const root = await rootHex(leaves);
      for (let i = 0; i < n; i++) {
        const path = await proofHex(leaves, i);
        expect(await verifyProofHex(leaves[i], i, n, path, root)).toBe(true);
        if (n > 1) expect(await verifyProofHex(leaves[(i + 1) % n], i, n, path, root)).toBe(false);
      }
    }
  }, 120_000);
  it("root changes when any leaf changes", async () => {
    const leaves = await Promise.all(Array.from({ length: 9 }, (_, i) => sha256Hex(`l${i}`)));
    const root = await rootHex(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const copy = [...leaves];
      copy[i] = await sha256Hex("evil");
      expect(await rootHex(copy)).not.toBe(root);
    }
  });
});

describe("checkpoints", () => {
  it("sign and verify; any change breaks the signature", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    expect(await publicKeyFromPrivate(privateKey)).toBe(publicKey);
    const hashes = await Promise.all(["a", "b", "c"].map((x) => sha256Hex(x)));
    const cp = await signCheckpoint(await buildCheckpoint({ space: SPACE, hashes, prev: null, keyId: "k1" }), privateKey);
    expect(cp.size).toBe("00000003");
    expect(cp.seq).toBe("000000000002");
    expect(await verifyCheckpointSig(cp, publicKey)).toBe(true);
    expect(await verifyCheckpointSig({ ...cp, size: "00000002" }, publicKey)).toBe(false);
    expect(await verifyCheckpointSig({ ...cp, anchor: { type: "github", repo: "x/y", commit: "abc", path: "p", anchoredSeq: "000000000001" } }, publicKey)).toBe(false);
    const next = await buildCheckpoint({ space: SPACE, hashes: [...hashes, await sha256Hex("d")], prev: cp, keyId: "k1" });
    expect(next.prevCheckpoint).toBe("cp_k7m2q9xa_000000000002");
    expect(next.prevCheckpointHash).toBe(await checkpointHash(cp));
  });
});

describe("replay", () => {
  it("handles supersede, contradict, forget and link", async () => {
    const c = new TestChain();
    await c.add({ text: "Ada is on the Pro plan", subject: "customer:ada" }); // 0
    await c.add({ text: "Ada downgraded to Basic", subject: "customer:ada", refs: { supersedes: [c.id(0)] } }); // 1
    await c.add({ text: "Ada's account is on the Pro plan", subject: "customer:ada", refs: { contradicts: [c.id(1)] } }); // 2
    let s = replay(c.entries.map((e) => ({ id: e.$id, h: e.metadata.h })));
    expect(s.get(c.id(0))!.status).toBe("superseded");
    expect(s.get(c.id(0))!.supersededBy).toBe(c.id(1));
    expect(s.get(c.id(1))!.contradictedBy).toEqual([c.id(2)]);
    expect(s.get(c.id(2))!.contradictedBy).toEqual([c.id(1)]);
    await c.add({ op: "link", kind: "supersede", text: null, refs: { target: c.id(2), supersedes: [c.id(2)], related: [c.id(1)] } }); // 3
    s = replay(c.entries.map((e) => ({ id: e.$id, h: e.metadata.h })));
    expect(s.get(c.id(2))!.status).toBe("superseded");
    expect(s.get(c.id(1))!.contradictedBy).toEqual([]);
    await c.add({ op: "forget", text: "user request", refs: { target: c.id(1) } }); // 4
    s = replay(c.entries.map((e) => ({ id: e.$id, h: e.metadata.h })));
    expect(s.get(c.id(1))!.status).toBe("forgotten");
    expect(s.get(c.id(4))!.status).toBe("recorded");
  });
});

describe("as-of", () => {
  it("returns the right set before, between and after changes", async () => {
    const c = new TestChain();
    await c.add({ text: "Pro", at: "2026-10-19T09:00:00.000Z" });
    await c.add({ text: "Basic", refs: { supersedes: [c.id(0)] }, at: "2026-10-22T11:15:00.000Z" });
    await c.add({ op: "forget", text: null, refs: { target: c.id(1) }, at: "2026-10-23T10:00:00.000Z" });
    const hs = c.entries.map((e) => ({ id: e.$id, h: e.metadata.h }));
    expect([...validSetAt(hs, "2026-10-20T00:00:00.000Z")]).toEqual([c.id(0)]);
    expect([...validSetAt(hs, "2026-10-22T12:00:00.000Z")]).toEqual([c.id(1)]);
    expect([...validSetAt(hs, "2026-10-24T00:00:00.000Z")]).toEqual([]);
    const m0 = c.entries[0].metadata, m1 = c.entries[1].metadata;
    expect(validAt(m0, "2026-10-20T00:00:00.000Z")).toBe(true);
    expect(validAt(m0, "2026-10-22T12:00:00.000Z")).toBe(false);
    expect(validAt(m1, "2026-10-22T12:00:00.000Z")).toBe(true);
    expect(validAt(m1, "2026-10-24T00:00:00.000Z")).toBe(false);
  });
});

describe("rerank", () => {
  it("scores, fuses and diversifies", () => {
    const now = Date.parse("2026-10-24T00:00:00Z");
    const a = scoreCandidate({ distance: 0.1, createdAt: "2026-10-23T00:00:00Z", importance: 5, access: 0, conflict: false, rrf: 1 }, now);
    const b = scoreCandidate({ distance: 0.1, createdAt: "2026-10-23T00:00:00Z", importance: 5, access: 0, conflict: true, rrf: 1 }, now);
    expect(a.score - b.score).toBeCloseTo(0.1);
    const f = rrfFuse([["x", "y"], ["y"]]);
    expect(f.get("y")).toBe(1);
    const picked = mmr([
      { id: "1", score: 1, vector: [1, 0] }, { id: "2", score: 0.99, vector: [1, 0] }, { id: "3", score: 0.8, vector: [0, 1] },
    ], 2);
    expect(picked.map((p) => p.id)).toEqual(["1", "3"]);
    expect(keywordTerms('What plan is Ada Okafor on per "INV-204"?')).toContain("INV-204");
  });
  it("detects tombstones", () => {
    expect(isTombstone(tombstoneVector(8))).toBe(true);
    expect(isTombstone([0.5, 0.5])).toBe(false);
  });
});
