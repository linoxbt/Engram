import { describe, expect, it, beforeAll } from "vitest";
import { verifySpace, runAttack, ATTACKS, contentHash, type ChainEntry, type Checkpoint } from "../src/index";
import { SPACE, TestChain, checkpointAt, keys } from "./helpers";

let chain: TestChain;
let cps: Checkpoint[];
let pub: string;

beforeAll(async () => {
  const k = await keys();
  pub = k.publicKey;
  chain = new TestChain();
  await chain.add({ text: "Ada Okafor is the operations lead at Kestrel Foods.", subject: "customer:ada" }); // 0
  await chain.add({ text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" }); // 1
  await chain.add({ text: "Ada prefers email over phone calls.", subject: "customer:ada", kind: "preference" }); // 2
  await chain.add({ text: "Kestrel Foods paid invoice INV-204 on time.", subject: "customer:kestrel" }); // 3
  await chain.add({ text: "Ada shared a delivery address: 14 Palm Close, Lekki.", subject: "customer:ada" }); // 4
  await chain.add({ text: "Ada downgraded from the Pro plan to Basic.", subject: "customer:ada", refs: { supersedes: [chain.id(1)] } }); // 5
  await chain.add({ text: "Ada's account is on the Pro plan.", subject: "customer:ada", refs: { contradicts: [chain.id(5)] } }); // 6
  await chain.add({ op: "link", kind: "supersede", text: null, refs: { target: chain.id(6), supersedes: [chain.id(6)], related: [chain.id(5)] } }); // 7
  await chain.add({ op: "forget", text: "user request", refs: { target: chain.id(4) } }); // 8
  for (let i = 0; i < 7; i++) await chain.add({ text: `background ${i}` }); // 9-15
  const c1 = await checkpointAt(chain.entries, 8, k.privateKey, null);
  const c2 = await checkpointAt(chain.entries, 16, k.privateKey, c1);
  cps = [c1, c2];
});

const run = (entries: ChainEntry[], mode: "standard" | "deep" = "standard", checkpoints = cps) =>
  verifySpace({ space: SPACE, entries, checkpoints, publicKeyHex: pub, mode });

describe("verifier", () => {
  it("accepts an untouched chain in every mode", async () => {
    for (const mode of ["standard", "deep"] as const) {
      const r = await run(chain.clone(), mode);
      expect(r.findings).toEqual([]);
      expect(r.status).toBe("valid");
      expect(r.validThrough).toBe(15);
      expect(r.checkpointsValid).toBe(2);
    }
    const pubOnly = chain.clone().map((e) => ({ $id: e.$id, h: e.metadata.h, hash: e.metadata.hash }));
    const r = await verifySpace({ space: SPACE, entries: pubOnly, checkpoints: cps, publicKeyHex: pub, mode: "public" });
    expect(r.status).toBe("valid");
  });

  it("rejects a forged checkpoint signature", async () => {
    const bad = [{ ...cps[0], root: cps[1].root }, cps[1]];
    const r = await run(chain.clone(), "standard", bad);
    expect(r.findings.map((f) => f.rule)).toContain("signature");
  });

  for (const a of ATTACKS) {
    it(`catches attack "${a.id}" with ${a.expectRules.join(" + ")}`, async () => {
      const params = a.id === "edit-text" || a.id === "edit-fix-content" || a.id === "edit-fix-hash" || a.id === "poison-vector"
        ? { seq: 5 } : a.id === "rewrite-suffix" ? { seq: 9 } : a.id === "swap" ? { seq: 2, otherSeq: 3 } : {};
      const res = await runAttack(a.id, chain.clone(), params);
      const r = await run(res.entries, a.deepOnly ? "deep" : "standard");
      const rules = [...new Set(r.findings.map((f) => f.rule))].sort();
      expect(rules).toEqual([...a.expectRules].sort());
      expect(r.findings.every((f) => f.severity === (a.id === "hide-supersession" ? "warning" : "critical"))).toBe(true);
      if (a.id === "edit-text") {
        expect(r.findings[0].seq).toBe(5);
        expect(r.validThrough).toBe(4);
      }
      // The edit at #9 sits after checkpoint 1 (size 8), so #0-#7 stay provably intact.
      if (a.id === "rewrite-suffix") expect(r.validThrough).toBe(7);
      if (a.id === "truncate") expect(r.findings[0].message).toMatch(/^Three memories are missing/);
    });
  }

  it("standard mode does not need vectors, so vector poisoning needs deep mode", async () => {
    const res = await runAttack("poison-vector", chain.clone(), { seq: 5 });
    expect((await run(res.entries, "standard")).findings).toEqual([]);
  });

  it("flags a vector blanked to the tombstone without a forget entry (spec correction)", async () => {
    const es = chain.clone();
    es[2].vector = es[8].vector;
    const r = await run(es, "deep");
    expect(r.findings.map((f) => f.rule)).toEqual(["vector"]);
  });

  it("a forgotten memory cannot be reproduced without its deleted salt", async () => {
    const forgotten = chain.entries[4].metadata;
    expect(forgotten.c).toEqual({ text: null, salt: null });
    const guess = await contentHash("", "Ada shared a delivery address: 14 Palm Close, Lekki.");
    expect(guess).not.toBe(forgotten.h.contentHash);
  });
});

describe("checkpoint keyring", () => {
  it("verifies checkpoints signed before and after a key rotation, and rejects an unknown key", async () => {
    const { buildCheckpoint, signCheckpoint, generateKeyPair, parseKeyring } = await import("../src/index");
    const chain = new TestChain();
    for (let i = 0; i < 6; i++) await chain.add({});
    const oldKey = await generateKeyPair(), newKey = await generateKeyPair();
    const hashes = chain.entries.map((e) => e.metadata.hash);
    const c1 = await signCheckpoint(await buildCheckpoint({ space: SPACE, hashes: hashes.slice(0, 3), prev: null, keyId: "cp-old" }), oldKey.privateKey);
    const c2 = await signCheckpoint(await buildCheckpoint({ space: SPACE, hashes, prev: c1, keyId: "cp-new" }), newKey.privateKey);
    const publicKeys = parseKeyring(`cp-old:${oldKey.publicKey}, cp-new:${newKey.publicKey}`);
    expect((await verifySpace({ space: SPACE, entries: chain.entries, checkpoints: [c1, c2], publicKeys })).status).toBe("valid");
    const missing = await verifySpace({ space: SPACE, entries: chain.entries, checkpoints: [c1, c2], publicKeys: { "cp-new": newKey.publicKey } });
    expect(missing.status).toBe("tampered");
    expect(missing.findings[0].message).toMatch(/unknown key \(cp-old\)/);
  });

  it("parses a keyring and keeps a legacy key under its ID", async () => {
    const { parseKeyring } = await import("../src/index");
    const hex = "a".repeat(64);
    expect(parseKeyring(`k1:${hex},bad,k2:xyz`, "b".repeat(64), "legacy")).toEqual({ k1: hex, legacy: "b".repeat(64) });
  });
});

describe("hostile and malformed inputs", () => {
  it("a frontier that does not match the size is refused, never hashed into a wrong root", async () => {
    const { frontierAppendHex, rootHex } = await import("../src/index");
    const hashes = chain.entries.slice(0, 6).map((e) => e.metadata.hash);
    const f3 = await frontierAppendHex([], 0, hashes.slice(0, 3));
    await expect(frontierAppendHex(f3.slice(1), 3, hashes.slice(3))).rejects.toThrow(/frontier has 1 subtrees/);
    await expect(frontierAppendHex(f3, 4, hashes.slice(3))).rejects.toThrow(RangeError);
    // The matching frontier still reproduces the full rebuild.
    const root = await (await import("../src/index")).frontierRootHex(await frontierAppendHex(f3, 3, hashes.slice(3)));
    expect(root).toBe(await rootHex(hashes));
  });

  it("entries with a null or garbage metadata, and null page elements, become findings instead of crashes", async () => {
    const entries = chain.entries.slice(0, 4);
    const headerOnly = (e: ChainEntry) => ({ $id: e.$id, h: e.metadata.h, hash: e.metadata.hash, metadata: null }) as unknown as ChainEntry;
    // metadata: null reads as header-only and still verifies.
    const r1 = await verifySpace({ space: SPACE, entries: entries.map(headerOnly) });
    expect(r1.status).toBe("valid");
    // A null element and a metadata that is a number are reported, not thrown.
    const hostile = [entries[0], null, { $id: entries[2].$id, metadata: 7 }, entries[3]] as unknown as ChainEntry[];
    const r2 = await verifySpace({ space: SPACE, entries: hostile });
    expect(r2.status).toBe("tampered");
    expect(r2.findings.some((f) => f.rule === "structure" || f.rule === "header")).toBe(true);
  });

  it("sameSet treats duplicates as one element", async () => {
    const { sameSet } = await import("../src/replay");
    expect(sameSet(["m_1", "m_1"], ["m_1", "m_2"])).toBe(false);
    expect(sameSet(["m_2", "m_1"], ["m_1", "m_2"])).toBe(true);
    expect(sameSet(["m_1", "m_1"], ["m_1"])).toBe(true);
    expect(sameSet([], [])).toBe(true);
  });
});
