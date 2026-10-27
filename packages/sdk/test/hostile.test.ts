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

describe("hostile responses and bad arguments", () => {
  it("refuses arguments it knows the server will reject, without a request", async () => {
    let calls = 0;
    const mem = client((async () => { calls++; return res(200, {}); }) as typeof fetch);
    const bad = [
      () => mem.remember({} as never),
      () => mem.remember({ text: "   " }),
      () => mem.recall({} as never),
      () => mem.forget("../../etc/passwd"),
      () => mem.get(""),
      () => mem.proof(null as never),
      () => mem.timeline("customer:ada", "5&mode=deep" as never),
      () => mem.timeline("customer:ada", 0),
      () => mem.timeline(42 as never),
      () => mem.resolve({ winnerId: "", loserId: "x" }),
    ];
    for (const call of bad) await expect(call()).rejects.toBeInstanceOf(EngramError);
    expect(calls).toBe(0);
    expect(() => new Engram({ url: "https://e.test", key: "k\nX-Evil: 1" })).toThrow();
    expect(() => new Engram({ url: "https://e.test", key: "k", timeoutMs: Number("x") })).toThrow();
  });

  it("gives up on an endless body and on a fetch that ignores the abort signal", async () => {
    const endless = (async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1 << 20)); } }), { status: 200 })) as typeof fetch;
    await expect(client(endless).me()).rejects.toMatchObject({ code: "too_large" });
    const never = (async () => new Promise<Response>(() => {})) as typeof fetch;
    const slow = new Engram({ url: "https://e.test", key: "k", fetch: never, retries: 0, timeoutMs: 50 });
    await expect(slow.me()).rejects.toMatchObject({ code: "timeout" });
  });

  it("keeps the error shape when the server sends rubbish in it", async () => {
    const mem = client((async () => res(400, { error: { code: { $: 1 }, message: ["nope"] } })) as typeof fetch);
    const err = await mem.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngramError);
    expect(typeof (err as EngramError).code).toBe("string");
    expect(typeof (err as EngramError).message).toBe("string");
  });
});
