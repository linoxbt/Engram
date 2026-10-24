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
