import { describe, expect, it } from "vitest";
import { buildCheckpoint, generateKeyPair, proofHex, sha256Hex, signCheckpoint } from "@engram/core";
import { Engram, EngramError } from "../src/index";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("engram-sdk", () => {
  it("sends the bearer key and retries chain contention", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    let n = 0;
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get("authorization") });
      return ++n < 3 ? res(503, { error: { code: "chain_busy", message: "busy" } }) : res(200, { id: "m_k7m2q9xa_000000000001", seq: 1, status: "created", relations: [] });
    }) as typeof fetch;
    const mem = new Engram({ url: "https://engram.test/", key: "eng_AAAA_x", fetch: f });
    const r = await mem.remember({ text: "Ada prefers email.", idempotencyKey: "k1" });
    expect(r.seq).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ url: "https://engram.test/api/v1/memories", auth: "Bearer eng_AAAA_x" });
  });

  it("maps errors and refuses oversized memories locally", async () => {
    const mem = new Engram({ url: "https://e.test", key: "k", fetch: (async () => res(403, { error: { code: "forbidden", message: "no scope" } })) as typeof fetch, retries: 0 });
    await expect(mem.recall({ query: "x" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(() => mem.remember({ text: "x".repeat(2001) })).toThrow(EngramError);
  });

  it("checks inclusion proofs and signatures locally", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const leaves = await Promise.all(Array.from({ length: 7 }, (_, i) => sha256Hex(`entry ${i}`)));
    const cp = await signCheckpoint(await buildCheckpoint({ space: "k7m2q9xa", hashes: leaves, prev: null, keyId: "t" }), privateKey);
    const proof = { id: "m_k7m2q9xa_000000000003", seq: 3, leaf: leaves[3], index: 3, path: await proofHex(leaves, 3), checkpoint: { ...cp, file: "cp" }, publicKey, howToVerify: "" };
    const mem = new Engram({ url: "https://e.test", key: "k", fetch: (async () => res(200, {})) as typeof fetch });
    expect(await mem.verifyProof(proof)).toEqual({ ok: true, rootOk: true, signatureOk: true });
    expect((await mem.verifyProof({ ...proof, leaf: leaves[4] })).rootOk).toBe(false);
    const other = await generateKeyPair();
    expect((await mem.verifyProof(proof, other.publicKey)).signatureOk).toBe(false);
  });
});
