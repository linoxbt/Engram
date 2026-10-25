/** Function deployment (contract 9): the signing key is never overwritten, rotation needs a new key ID, nothing deploys with a gap. */
import { describe, expect, it } from "vitest";
import { generateKeyPair } from "@engram/core";
import { planVariables, type ExistingVar } from "../../../scripts/deploy-plan";

const v = (key: string, value = "x", secret = false): ExistingVar => ({ $id: `id_${key}`, key, value, secret });

async function env(keyId = "engram-cp-2026-10") {
  const kp = await generateKeyPair();
  return { kp, vars: { CP_KEY_ID: keyId, CP_PRIVATE_KEY: kp.privateKey, CP_PUBLIC_KEYS: `${keyId}:${kp.publicKey}`, NEXT_PUBLIC_APP_URL: "https://engram.example" } as Record<string, string | undefined> };
}

describe("function variable plan", () => {
  it("creates the signing key only when the Function has none", async () => {
    const { vars } = await env();
    const first = await planVariables("checkpoint", vars, []);
    expect(first.errors).toEqual([]);
    expect(first.actions).toContainEqual(expect.objectContaining({ kind: "create", key: "CP_PRIVATE_KEY", secret: true }));
    expect(first.actions).toContainEqual(expect.objectContaining({ kind: "create", key: "CP_PUBLIC_KEYS", secret: false }));
    expect(first.actions).toContainEqual(expect.objectContaining({ kind: "create", key: "CP_KEY_ID", secret: false }));

    const other = await env();
    const again = await planVariables("checkpoint", other.vars, [v("CP_PRIVATE_KEY", "", true), v("CP_KEY_ID", "engram-cp-2026-10")]);
    expect(again.errors).toEqual([]);
    expect(again.actions.filter((a) => a.key === "CP_PRIVATE_KEY")).toEqual([expect.objectContaining({ kind: "keep" })]);
  });

  it("never deletes the signing key, and removes variables a Function no longer uses", async () => {
    const { vars } = await env();
    const plan = await planVariables("sentinel", vars, [v("CP_PRIVATE_KEY", "", true), v("NEXT_PUBLIC_CP_PUBLIC_KEY"), v("LABELER_FUNCTION_ID")]);
    const deleted = plan.actions.filter((a) => a.kind === "delete").map((a) => a.key);
    expect(deleted.sort()).toEqual(["LABELER_FUNCTION_ID", "NEXT_PUBLIC_CP_PUBLIC_KEY"]);
    expect(plan.actions.some((a) => a.key === "CP_PRIVATE_KEY")).toBe(false);
  });

  it("rotates only with --rotate-key, a new key ID, and the old public key still listed", async () => {
    const old = await generateKeyPair();
    const { kp, vars } = await env("engram-cp-2026-11");
    const existing = [v("CP_PRIVATE_KEY", "", true), v("CP_KEY_ID", "engram-cp-2026-10")];
    // Without the flag: the key stays, and the key ID may not change under it.
    const noFlag = await planVariables("checkpoint", { ...vars, CP_PUBLIC_KEYS: `engram-cp-2026-10:${old.publicKey},engram-cp-2026-11:${kp.publicKey}` }, existing);
    expect(noFlag.errors.join(" ")).toMatch(/only with --rotate-key/);
    // Same key ID: refused.
    const same = await planVariables("checkpoint", { ...vars, CP_KEY_ID: "engram-cp-2026-10", CP_PUBLIC_KEYS: `engram-cp-2026-10:${kp.publicKey}` }, existing, { rotateKey: true });
    expect(same.errors.join(" ")).toMatch(/new CP_KEY_ID/);
    // Old key dropped from the keyring: refused.
    const dropped = await planVariables("checkpoint", vars, existing, { rotateKey: true });
    expect(dropped.errors.join(" ")).toMatch(/keep the old key/);
    // The runbook.
    const ok = await planVariables("checkpoint", { ...vars, CP_PUBLIC_KEYS: `engram-cp-2026-10:${old.publicKey},engram-cp-2026-11:${kp.publicKey}` }, existing, { rotateKey: true });
    expect(ok.errors).toEqual([]);
    expect(ok.actions).toContainEqual(expect.objectContaining({ kind: "update", key: "CP_PRIVATE_KEY", variableId: "id_CP_PRIVATE_KEY" }));
    expect(ok.actions).toContainEqual(expect.objectContaining({ kind: "update", key: "CP_KEY_ID", value: "engram-cp-2026-11" }));
  });

  it("fails when a required variable is missing or the private key does not match the keyring", async () => {
    const { vars } = await env();
    expect((await planVariables("checkpoint", { ...vars, NEXT_PUBLIC_APP_URL: undefined }, [])).errors.join(" ")).toMatch(/NEXT_PUBLIC_APP_URL/);
    expect((await planVariables("checkpoint", { ...vars, CP_PRIVATE_KEY: undefined }, [])).errors.join(" ")).toMatch(/CP_PRIVATE_KEY is required/);
    expect((await planVariables("sentinel", { ...vars, CP_PUBLIC_KEYS: undefined }, [])).errors.join(" ")).toMatch(/CP_PUBLIC_KEYS is required/);
    const stranger = await generateKeyPair();
    expect((await planVariables("checkpoint", { ...vars, CP_PRIVATE_KEY: stranger.privateKey }, [])).errors.join(" ")).toMatch(/does not match/);
  });

  it("passes model keys to the Functions that call a model, and never the signing key", async () => {
    const { vars } = await env();
    const withModels = { ...vars, OPENAI_API_KEY: "sk-o", ANTHROPIC_API_KEY: "sk-ant" };
    for (const fn of ["reflect", "labeler", "sentinel"]) {
      const keys = (await planVariables(fn, withModels, [])).actions.map((a) => a.key);
      expect(keys).toEqual(expect.arrayContaining(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]));
      expect(keys).not.toContain("CP_PRIVATE_KEY");
    }
    expect((await planVariables("checkpoint", withModels, [])).actions.map((a) => a.key)).not.toContain("OPENAI_API_KEY");
  });
});
