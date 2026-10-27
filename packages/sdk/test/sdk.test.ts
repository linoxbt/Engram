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
    await expect(mem.remember({ text: "x".repeat(2001) })).rejects.toBeInstanceOf(EngramError);
  });

  it("does not blindly retry writes, and survives non-JSON gateways", async () => {
    let n = 0;
    const gateway = (async () => { n++; return new Response("<html>Bad gateway</html>", { status: 503 }); }) as typeof fetch;
    const mem = new Engram({ url: "https://e.test", key: "k", fetch: gateway });
    await expect(mem.resolve({ winnerId: "a", loserId: "b" })).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(1);
    n = 0;
    await expect(mem.recall({ query: "x" })).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(4);
    let body: { idempotencyKey?: string } = {};
    const ok = (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return res(200, { id: "x" }); }) as typeof fetch;
    await new Engram({ url: "https://e.test", key: "k", fetch: ok }).remember({ text: "hi" });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("types every field the API actually sends", async () => {
    const wire = {
      recall: {
        query: "q", asOf: null, mode: "now", memories: [], conflicts: 0, tookMs: 4,
        checkpoint: { fileId: "cp_k7m2q9xa_000000000003", seq: 3, size: 4, root: "a".repeat(64), createdAt: "2026-10-27T00:00:00.000Z" },
        integrity: { status: "valid", validThrough: 3, entries: 4, findings: 0, critical: 0, checkedAt: "2026-10-27T00:00:00.000Z", firstFinding: null },
        integritySource: "monitor",
      },
      timeline: { subject: "customer:ada", next: "m_k7m2q9xa_000000000002", entries: [{ seq: 2, id: "m_k7m2q9xa_000000000002", op: "remember", kind: "fact", text: "t", status: "active", createdAt: "2026-10-27T00:00:00.000Z", agent: "a", agentName: "A", target: null, source: null, relations: { supersedes: [], contradicts: [], related: [], supersededBy: null, contradictedBy: [] } }] },
      me: { agent: { id: "a", name: "A", scopes: ["recall"] }, space: { key: "k7m2q9xa", name: "S" }, integrity: null, latestCheckpoint: null },
    };
    const f = (async (url: string) => res(200, url.includes("/recall") ? wire.recall : url.includes("/timeline") ? wire.timeline : wire.me)) as typeof fetch;
    const mem = new Engram({ url: "https://e.test", key: "k", fetch: f });
    const r = await mem.recall({ query: "q" });
    expect(r.integritySource).toBe("monitor");
    expect(r.integrity?.status).toBe("valid");
    expect(r.checkpoint?.size).toBe(4);
    const t = await mem.timeline("customer:ada", 1);
    expect(t.next).toBe("m_k7m2q9xa_000000000002");
    expect(t.entries[0].relations.contradictedBy).toEqual([]);
    expect((await mem.me()).latestCheckpoint).toBeNull();
  });

  it("checks inclusion proofs and signatures locally", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const leaves = await Promise.all(Array.from({ length: 7 }, (_, i) => sha256Hex(`entry ${i}`)));
    const cp = await signCheckpoint(await buildCheckpoint({ space: "k7m2q9xa", hashes: leaves, prev: null, keyId: "t" }), privateKey);
    const proof = { id: "m_k7m2q9xa_000000000003", seq: 3, leaf: leaves[3], index: 3, path: await proofHex(leaves, 3), checkpoint: { ...cp, file: "cp" }, publicKey, howToVerify: "" };
    const mem = new Engram({ url: "https://e.test", key: "k", fetch: (async () => res(200, {})) as typeof fetch });
    // The key inside the proof comes from the server being checked, so it is never enough on its own.
    expect(await mem.verifyProof(proof)).toMatchObject({ ok: false, rootOk: true, signatureOk: null });
    expect(await mem.verifyProof(proof, publicKey)).toEqual({ ok: true, rootOk: true, signatureOk: true });
    const pinned = new Engram({ url: "https://e.test", key: "k", publicKey, fetch: (async () => res(200, {})) as typeof fetch });
    expect((await pinned.verifyProof(proof)).ok).toBe(true);
    expect((await pinned.verifyProof({ ...proof, leaf: leaves[4] })).rootOk).toBe(false);
    expect((await pinned.verifyProof(proof, undefined, leaves[5])).ok).toBe(false);
    expect((await pinned.verifyProof({ ...proof, checkpoint: { ...proof.checkpoint, size: "1e12" } })).problem).toMatch(/size/);
    const other = await generateKeyPair();
    expect((await mem.verifyProof(proof, other.publicKey)).signatureOk).toBe(false);
  });
});
