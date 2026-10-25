import { afterEach, describe, expect, it, vi } from "vitest";
import { proofHex } from "@engram/core";
import { SPACE, TestChain, checkpointAt, keys } from "../../../packages/core/test/helpers";

async function setup() {
  const c = new TestChain();
  for (let i = 0; i < 7; i++) await c.add({});
  const k = await keys();
  const cp = await checkpointAt(c.entries, 7, k.privateKey, null);
  const leaves = c.entries.map((e) => e.metadata.hash);
  return { c, k, cp, leaves, path: await proofHex(leaves, 3) };
}

/** proof.ts reads the built-in keyring at import time, like the real bundle. */
async function load(keyring?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CP_PUBLIC_KEYS", keyring ?? "");
  vi.stubEnv("NEXT_PUBLIC_CP_PUBLIC_KEY", "");
  return import("@/lib/client/proof");
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("inclusion proof walk", () => {
  it("takes the verdict from core and only shows steps once it is known", async () => {
    const { cp, leaves, path, k } = await setup();
    const { walkProof, stepMarks } = await load(`test:${k.publicKey}`);
    const w = await walkProof({ leaf: leaves[3], index: 3, path, checkpoint: cp, serverKey: k.publicKey });
    expect(w.rootOk).toBe(true);
    expect(w.steps).toHaveLength(path.length + 1);
    expect(w.steps[w.steps.length - 1].hash).toBe(cp.root);
    expect(stepMarks(w.steps.length, null).every((m) => m === "pending")).toBe(true);
    expect(stepMarks(w.steps.length, true).every((m) => m === "ok")).toBe(true);
  });

  it("marks the root step as failed when the proof does not reach the signed root", async () => {
    const { cp, leaves, path, k } = await setup();
    const { walkProof, stepMarks } = await load(`test:${k.publicKey}`);
    const w = await walkProof({ leaf: leaves[4], index: 3, path, checkpoint: cp, serverKey: k.publicKey });
    expect(w.rootOk).toBe(false);
    const marks = stepMarks(w.steps.length, w.rootOk);
    expect(marks[marks.length - 1]).toBe("fail");
    expect(marks.slice(0, -1).includes("ok")).toBe(false);
  });
});

describe("checkpoint signatures use the built-in key for the checkpoint's key ID", () => {
  it("is valid only with a pinned key", async () => {
    const { cp, k } = await setup();
    const { checkSignature, sigState } = await load(`test:${k.publicKey}`);
    expect(sigState(await checkSignature(cp, k.publicKey))).toBe("valid");
  });

  it("ignores a key swapped by the server", async () => {
    const { cp, k } = await setup();
    const evil = await keys();
    const { checkSignature, sigState } = await load(`test:${k.publicKey}`);
    const s = await checkSignature(cp, evil.publicKey);
    expect(s.ok).toBe(true); // checked with the built-in key, not the server's
    expect(sigState(s)).toBe("mismatch");
  });

  it("warns when the site has no built-in key, even if the server's key matches", async () => {
    const { cp, k } = await setup();
    const { checkSignature, sigState } = await load();
    const s = await checkSignature(cp, k.publicKey);
    expect(s).toMatchObject({ ok: true, pinned: false });
    expect(sigState(s)).toBe("unpinned");
  });

  it("does not check a checkpoint signed with an unknown key ID", async () => {
    const { cp, k } = await setup();
    const { checkSignature, sigState } = await load(`other:${k.publicKey}`);
    expect(sigState(await checkSignature(cp, k.publicKey))).toBe("unknown-key");
  });

  it("rejects a forged signature", async () => {
    const { cp, k } = await setup();
    const { checkSignature, sigState } = await load(`test:${k.publicKey}`);
    expect(sigState(await checkSignature({ ...cp, root: "0".repeat(64) }, k.publicKey))).toBe("invalid");
  });
});

void SPACE;
