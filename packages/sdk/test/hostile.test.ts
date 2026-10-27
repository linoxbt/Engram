/** What the SDK does when the server is the attacker: proofs from elsewhere, malformed fields, endless bodies. */
import { describe, expect, it } from "vitest";
import { buildCheckpoint, generateKeyPair, proofHex, sha256Hex, signCheckpoint } from "@engram/core";
import { Engram, EngramError, type Proof } from "../src/index";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const client = (f: typeof fetch = (async () => res(200, {})) as typeof fetch, publicKey?: string) =>
  new Engram({ url: "https://e.test", key: "k", publicKey, fetch: f, retries: 0 });

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair();
  const leaves = await Promise.all(Array.from({ length: 7 }, (_, i) => sha256Hex(`entry ${i}`)));
  const sign = (space: string) => buildCheckpoint({ space, hashes: leaves, prev: null, keyId: "t" }).then((u) => signCheckpoint(u, privateKey));
  const mine = await sign("k7m2q9xa");
  const theirs = await sign("zzzzzzzz");
  const proof = async (cp: Awaited<ReturnType<typeof sign>>, i: number): Promise<Proof> => ({
    id: `m_k7m2q9xa_${String(i).padStart(12, "0")}`, seq: i, leaf: leaves[i], index: i,
    path: await proofHex(leaves, i), checkpoint: { ...cp, file: "cp" }, publicKey, howToVerify: "",
  });
  return { publicKey, leaves, good: await proof(mine, 2), foreign: await proof(theirs, 2) };
}

describe("verifyProof against a hostile server", () => {
  it("rejects a signed checkpoint that belongs to another space", async () => {
    const { publicKey, leaves, good, foreign } = await fixture();
    const mem = client(undefined, publicKey);
    expect((await mem.verifyProof(good)).ok).toBe(true);
    // The signing key is global, so a real signature over leaves the attacker chose must still not prove anything here.
    const r = await mem.verifyProof(foreign);
    expect(r).toMatchObject({ ok: false, rootOk: false, signatureOk: null });
    expect(r.problem).toMatch(/space/);
    expect((await mem.verifyProof(foreign, publicKey, leaves[2])).ok).toBe(false);
  });

  it("ties the leaf index to the entry id the proof claims", async () => {
    const { publicKey, leaves, good } = await fixture();
    const mem = client(undefined, publicKey);
    expect((await mem.verifyProof({ ...good, id: "m_k7m2q9xa_000000000003" })).ok).toBe(false);
    expect((await mem.verifyProof({ ...good, seq: 9 })).ok).toBe(false);
    // A path that does reach the root at another index is still not a proof for this id.
    const moved: Proof = { ...good, index: 4, leaf: leaves[4], path: await proofHex(leaves, 4) };
    expect(await mem.verifyProof(moved)).toMatchObject({ ok: false, rootOk: false });
    expect((await mem.verifyProof({ ...good, id: "not an id" })).ok).toBe(false);
  });

  it("returns a problem instead of throwing on any malformed proof", async () => {
    const { publicKey, good } = await fixture();
    const mem = client(undefined, publicKey);
    const broken: unknown[] = [
      null, "proof", { ...good, leaf: "zz".repeat(32) }, { ...good, leaf: null }, { ...good, leaf: 3 },
      { ...good, path: ["nothex"] }, { ...good, path: "x" }, { ...good, path: null }, { ...good, path: [null] },
      { ...good, path: new Array(100_000).fill(good.leaf) }, { ...good, index: "2" }, { ...good, index: 1.5 },
      { ...good, checkpoint: null }, { ...good, checkpoint: { ...good.checkpoint, sig: 7 } }, { ...good, id: null },
    ];
    for (const p of broken) {
      const r = await mem.verifyProof(p as Proof);
      expect(r.ok, JSON.stringify(p).slice(0, 60)).toBe(false);
      expect(typeof r.problem).toBe("string");
    }
  });
});
