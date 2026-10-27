/**
 * Regression tests for the second external audit. Each one reproduces a defect that let a hostile server, or a
 * plain mistake, pass verification; each failed before the fix in the same commit.
 */
import { describe, expect, it } from "vitest";
import {
  ChainVerifier, canonical, contentHash, embHash, isTombstone, parseKeyring, parseKeyringStrict, quantize,
  runAttack, tombstoneVector, validSetAt, verifySpace, DERIVED_WINDOW,
  type ChainEntry, type Checkpoint, type PublicEntry,
} from "../src/index";
import { SPACE, TestChain, checkpointAt, keys, vec } from "./helpers";

const headerOnly = (e: ChainEntry): PublicEntry => ({ $id: e.$id, h: e.metadata.h, hash: e.metadata.hash });

async function plainChain(n: number): Promise<TestChain> {
  const c = new TestChain();
  for (let i = 0; i < n; i++) await c.add({ text: `fact ${i}` });
  return c;
}

describe("A1 coverage: a server cannot disable checks by serving an entry header-only", () => {
  it("reports the downgrade and the real coverage instead of calling the chain valid", async () => {
    const c = await plainChain(6);
    const full = c.clone();
    full[2].metadata = { ...full[2].metadata, c: { ...full[2].metadata.c, text: "forged" }, text: "forged" };
    const served = await verifySpace({ space: SPACE, entries: full });
    expect(served.status).toBe("tampered");

    // Same chain, same edit, but #2 is reduced to its header: the content rule has nothing to check.
    const downgraded: (ChainEntry | PublicEntry)[] = full.map((e, i) => (i === 2 ? headerOnly(e) : e));
    const r = await verifySpace({ space: SPACE, entries: downgraded });
    expect(r.status).toBe("tampered");
    expect(r.findings.some((f) => f.rule === "coverage" && f.severity === "critical" && /#2/.test(f.message))).toBe(true);
    expect(r.checked.entries).toBe(6);
    expect(r.checked.content).toBe(5);
    expect(r.checked.derived).toBe(5);
  });

  it("a wholly header-only page in standard mode is a warning, never a clean bill of health", async () => {
    const c = await plainChain(4);
    const r = await verifySpace({ space: SPACE, entries: c.clone().map(headerOnly) });
    expect(r.status).toBe("warning");
    expect(r.findings.map((f) => f.rule)).toContain("coverage");
    expect(r.checked.content).toBe(0);
    expect(r.checked.derived).toBe(0);
    expect(r.checked.entries).toBe(4);
  });

  it("public mode is a supported headers-only mode and stays clean", async () => {
    const c = await plainChain(4);
    const r = await verifySpace({ space: SPACE, entries: c.clone().map(headerOnly), mode: "public" });
    expect(r.findings).toEqual([]);
    expect(r.status).toBe("valid");
    expect(r.checked).toEqual({ entries: 4, content: 0, vector: 0, derived: 0 });
  });
});

describe("A2 embHash cannot be made to collide by Int32 wraparound", () => {
  it("refuses components outside the unit range instead of hashing them mod 2^32", async () => {
    const v = [0.1, -0.2, 0.3, 0.4];
    const PERIOD = 2 ** 32 / 1e5; // 42949.67296
    const wrapped = [v[0] + PERIOD, v[1] + 2 * PERIOD, v[2] + PERIOD, v[3] + 2 * PERIOD];
    await expect(embHash(wrapped)).rejects.toThrow(/out of range/);
    expect(await embHash(v)).toBe("9c3e522fa628632ae956714374be3712b1620792d0474f0ec8398291aa5f6305");
  });

  it("hashes every legitimate vector exactly as before", async () => {
    // Golden hexes recorded before the change: a stored chain must keep verifying.
    expect(await embHash(tombstoneVector(16))).toBe("7daf115c9a1aff154ad369d4546ae0b86522216b7d008b3d027597fb191b5514");
    expect(await embHash(tombstoneVector(768))).toBe("f6610f6ef36f80ff372473844bc22e9eeaab2a124503a94e3b1f05952fcee256");
    expect(await embHash([])).toBe("e9d0a8a3d3318b78689b348af9fe18bd9396db51381c140ca078898380ce2f65");
    expect(await embHash(quantize([1, -1, 0.5, -0.000004]))).toBe("4e31571298a59509c6ab5cfe1c081bf4b9a074a7ad819c63a19e5f8d9d7a5869");
    expect(await embHash(vec(1))).toBe("6fcd0005c13a49b4cbd02a85a384fb95e70214a9d247d2276dad40296dac5e5c");
    expect(await embHash(vec(5))).toBe("46c8483f12c5d689ed1274c0f64e9f845bd6bfcd6051e73c4b23d299cf800204");
    expect(await embHash(vec(3), "saltysalt")).toBe("e497b0ae4b464f2af063da8ae9de55dca102317432ad72abf21521024a9aba5b");
  });
});

describe("A3 NaN is not a tombstone", () => {
  it("rejects a vector of NaN and refuses to hash it", async () => {
    const nan = new Array(16).fill(NaN);
    expect(isTombstone(nan)).toBe(false);
    expect(isTombstone([NaN, 0, 0])).toBe(false);
    await expect(embHash(nan)).rejects.toThrow(/out of range/);
    expect(isTombstone(tombstoneVector(16))).toBe(true);
  });
});

describe("A4 unverified checkpoints are never counted as valid", () => {
  it("a forged checkpoint verified without any key counts as unchecked, not valid", async () => {
    const c = await plainChain(5);
    const good = await keys(), attacker = await keys();
    const honest = await checkpointAt(c.entries, 5, good.privateKey, null);
    const forged = await checkpointAt(c.entries, 5, attacker.privateKey, null);
    const r = await verifySpace({ space: SPACE, entries: c.clone(), checkpoints: [forged] });
    expect(r.checkpointsValid).toBe(0);
    expect(r.checkpointsUnchecked).toBe(1);
    expect(r.signaturesChecked).toBe(false);
    expect(r.provenThrough).toBe(-1);
    // With the real key the same chain is fully proven.
    const ok = await verifySpace({ space: SPACE, entries: c.clone(), checkpoints: [honest], publicKeyHex: good.publicKey });
    expect(ok.checkpointsValid).toBe(1);
    expect(ok.signaturesChecked).toBe(true);
    expect(ok.provenThrough).toBe(4);
  });
});

describe("A5 the keyring never fails open", () => {
  it("drops dangerous key ids, accepts uppercase hex and tells the caller what it dropped", () => {
    const hex = "a".repeat(64);
    const proto = parseKeyringStrict(`__proto__:${hex}`);
    expect(proto.keys).toEqual({});
    expect(proto.dropped).toEqual([`__proto__:${hex}`]);
    expect(Object.keys(parseKeyring(`constructor:${hex}`))).toEqual([]);
    expect(parseKeyring(`k1:${"A".repeat(64)}`)).toEqual({ k1: hex });
    const mixed = parseKeyringStrict(`k1:${hex},nonsense,k2:${hex}`);
    expect(Object.keys(mixed.keys).sort()).toEqual(["k1", "k2"]);
    expect(mixed.dropped).toEqual(["nonsense"]);
  });

  it("a checkpoint signed with keyId 'toString' is an unknown key, not an invalid signature", async () => {
    const c = await plainChain(4);
    const k = await keys();
    const cp = { ...(await checkpointAt(c.entries, 4, k.privateKey, null)), keyId: "toString" } as Checkpoint;
    const r = await verifySpace({ space: SPACE, entries: c.clone(), checkpoints: [cp], publicKeys: { real: k.publicKey } });
    expect(r.findings.some((f) => /unknown key \(toString\)/.test(f.message))).toBe(true);
  });
});

describe("A6 text that is not already NFC is reported", () => {
  it("flags a decomposed text that hashes like its composed twin", async () => {
    const c = new TestChain();
    await c.add({ text: "Ada café owes 12 euros." });
    const es = c.clone();
    const swapped = "Ada café owes 12 euros.";
    expect(await contentHash("s", swapped)).toBe(await contentHash("s", "Ada café owes 12 euros."));
    es[0].metadata = { ...es[0].metadata, c: { ...es[0].metadata.c, text: swapped }, text: swapped };
    const r = await verifySpace({ space: SPACE, entries: es });
    expect(r.findings.some((f) => f.rule === "content" && /NFC|normal/i.test(f.message))).toBe(true);
  });

  it("canonical normalises keys as well as values, and leaves ASCII untouched", () => {
    expect(canonical({ "café": "x" })).toBe(canonical({ "café": "x" }));
    expect(canonical({ b: "x", a: { z: ["1", null] } })).toBe('{"a":{"z":["1",null]},"b":"x"}');
    expect(() => canonical({ "café": "x", "café": "y" })).toThrow(/same canonical key/);
  });
});

describe("A7 createdAt is measured against the running maximum", () => {
  it("catches a chain that walks backwards a little at a time", async () => {
    const c = new TestChain();
    let t = Date.parse("2026-10-20T12:00:00.000Z");
    for (let i = 0; i < 6; i++) {
      await c.add({ text: `drift ${i}`, at: new Date(t).toISOString() });
      t -= 1900;
    }
    const r = await verifySpace({ space: SPACE, entries: c.clone() });
    expect(r.findings.filter((f) => f.rule === "time").length).toBeGreaterThan(0);
  });

  it("still tolerates a single step inside the skew allowance", async () => {
    const c = new TestChain();
    await c.add({ text: "a", at: "2026-10-20T12:00:02.000Z" });
    await c.add({ text: "b", at: "2026-10-20T12:00:01.000Z" });
    await c.add({ text: "c", at: "2026-10-20T12:00:03.000Z" });
    const r = await verifySpace({ space: SPACE, entries: c.clone() });
    expect(r.findings.filter((f) => f.rule === "time")).toEqual([]);
  });
});

describe("A8 as-of replay skips out-of-window entries instead of stopping", () => {
  it("keeps a later-sequenced entry that was created earlier", async () => {
    const c = new TestChain();
    await c.add({ text: "first", at: "2026-10-19T09:00:00.000Z" });
    await c.add({ text: "future", at: "2026-10-25T09:00:00.000Z" });
    await c.add({ text: "backdated", at: "2026-10-20T09:00:00.000Z" });
    const hs = c.entries.map((e) => ({ id: e.$id, h: e.metadata.h }));
    const set = validSetAt(hs, "2026-10-21T00:00:00.000Z");
    expect([...set].sort()).toEqual([c.id(0), c.id(2)].sort());
  });
});

describe("A9 derived tampering outside the in-flight window is critical", () => {
  it("hiding a supersession is tampering, not a warning", async () => {
    const c = new TestChain();
    await c.add({ text: "Ada is on the Pro plan." });
    await c.add({ text: "Ada moved to Basic.", refs: { supersedes: [c.id(0)] } });
    for (let i = 0; i < DERIVED_WINDOW + 2; i++) await c.add({ text: `later ${i}` });
    const res = await runAttack("hide-supersession", c.clone());
    const r = await verifySpace({ space: SPACE, entries: res.entries });
    const derived = r.findings.filter((f) => f.rule === "derived");
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((f) => f.severity === "critical")).toBe(true);
    expect(r.status).toBe("tampered");
  });

  it("an entry whose neighbour update has not landed yet is only a warning", async () => {
    const c = new TestChain();
    await c.add({ text: "Ada is on the Pro plan." });
    await c.add({ text: "Ada moved to Basic.", refs: { supersedes: [c.id(0)] } });
    const es = c.clone();
    es[1].metadata = { ...es[1].metadata, applied: "false" };
    const res = await runAttack("hide-supersession", es);
    const r = await verifySpace({ space: SPACE, entries: res.entries });
    expect(r.findings.filter((f) => f.rule === "derived").every((f) => f.severity === "warning")).toBe(true);
  });
});

describe("A10 deep mode says so when a vector is missing", () => {
  it("does not report a clean deep verification over entries that carry no vector", async () => {
    const c = await plainChain(5);
    const es = c.clone();
    delete es[2].vector;
    const r = await verifySpace({ space: SPACE, entries: es, mode: "deep" });
    expect(r.findings.some((f) => f.rule === "vector" && /#2/.test(f.message))).toBe(true);
    expect(r.checked.vector).toBe(4);
    expect(r.status).toBe("tampered");
  });
});

describe("A11 the earliest checkpoint must be the genesis checkpoint", () => {
  it("reports a dropped first checkpoint", async () => {
    const c = await plainChain(9);
    const k = await keys();
    const c1 = await checkpointAt(c.entries, 3, k.privateKey, null);
    const c2 = await checkpointAt(c.entries, 6, k.privateKey, c1);
    const c3 = await checkpointAt(c.entries, 9, k.privateKey, c2);
    const full = await verifySpace({ space: SPACE, entries: c.clone(), checkpoints: [c1, c2, c3], publicKeyHex: k.publicKey });
    expect(full.findings).toEqual([]);
    const dropped = await verifySpace({ space: SPACE, entries: c.clone(), checkpoints: [c2, c3], publicKeyHex: k.publicKey });
    expect(dropped.findings.some((f) => f.rule === "checkpoint" && /earlier checkpoint|first checkpoint/i.test(f.message))).toBe(true);
  });
});

describe("A12 provenThrough separates 'internally consistent' from 'signed'", () => {
  it("reports only what the newest verified checkpoint covers", async () => {
    const c = await plainChain(12);
    const k = await keys();
    const cp = await checkpointAt(c.entries, 8, k.privateKey, null);
    const r = await verifySpace({ space: SPACE, entries: c.clone(), checkpoints: [cp], publicKeyHex: k.publicKey });
    expect(r.validThrough).toBe(11);
    expect(r.provenThrough).toBe(7);
    const none = await verifySpace({ space: SPACE, entries: c.clone(), publicKeyHex: k.publicKey });
    expect(none.provenThrough).toBe(-1);
  });
});

describe("A13 a link entry must carry a link kind", () => {
  it("refuses a link whose kind is a memory kind instead of silently unlinking the pair", async () => {
    const c = new TestChain();
    await c.add({ text: "Ada is on Pro." });
    await c.add({ text: "Ada is on Basic.", refs: { contradicts: [c.id(0)] } });
    await c.add({ op: "link", kind: "fact", text: null, refs: { target: c.id(0), related: [c.id(1)] } });
    const r = await verifySpace({ space: SPACE, entries: c.clone() });
    expect(r.findings.some((f) => f.rule === "header" && f.seq === 2)).toBe(true);
    expect(r.status).toBe("tampered");
  });
});

describe("A14 entries do not pretend to carry their own signature", () => {
  it("EntryMeta has no sig field", async () => {
    const c = await plainChain(1);
    expect("sig" in c.entries[0].metadata).toBe(false);
  });
});
describe("the coverage counters are honest for a full, untouched chain", () => {
  it("counts every entry it actually checked", async () => {
    const c = new TestChain();
    for (let i = 0; i < 4; i++) await c.add({ text: `fact ${i}` });
    await c.add({ op: "forget", text: "user request", refs: { target: c.id(1) } });
    const v = new ChainVerifier({ space: SPACE, mode: "deep" });
    await v.push(c.clone());
    const r = await v.finish([]);
    expect(r.findings).toEqual([]);
    expect(r.checked.entries).toBe(5);
    // #1 was erased, so four entries still carry text (three memories and the forget entry's reason).
    expect(r.checked.content).toBe(4);
    // Only live memories carry a real vector; #1 and the forget entry hold the tombstone.
    expect(r.checked.vector).toBe(3);
    expect(r.checked.derived).toBe(5);
    expect(r.signaturesChecked).toBe(false);
  });
});
