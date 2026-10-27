/**
 * Which variables each Appwrite Function gets, and what a deploy may change. Pure (no network), so it is tested.
 *
 * Rules (docs/key-rotation.md):
 *  - CP_PRIVATE_KEY is never overwritten or deleted. It is created only when the checkpoint Function has none, or
 *    replaced with --rotate-key together with a CP_KEY_ID that differs from the current one.
 *  - CP_PUBLIC_KEYS (every public key ever used, "keyId:hex,...") goes to the Functions that verify, and must list the
 *    signing key under CP_KEY_ID. CP_KEY_ID only changes together with the private key.
 *  - A required variable that is missing fails the deploy before anything is changed.
 *  - Variables a Function no longer needs are deleted (CP_PRIVATE_KEY excepted).
 */
import { parseKeyring, publicKeyFromPrivate } from "@engram/core";
import { DEFAULT_KEY_ID } from "../packages/server/src/config";

const SHARED = ["APPWRITE_DB_ID", "APPWRITE_CHECKPOINTS_BUCKET", "NEXT_PUBLIC_APP_URL", "ENGRAM_EMBED_PREFIXES", "ENGRAM_VECTOR_FILTERS"];
const KEYS = ["CP_KEY_ID", "CP_PUBLIC_KEYS"];
// Least privilege: model keys only go to the Functions that call a model (the sentinel re-classifies abandoned writes).
const MODEL = ["CLASSIFIER_MODEL", "CLASSIFIER_MODELS", "MODEL_API_KEY", "ANTHROPIC_WORKSPACE_ID", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

export const VARS: Record<string, string[]> = {
  checkpoint: [...SHARED, ...KEYS, "CP_PRIVATE_KEY", "GITHUB_ANCHOR_TOKEN", "GITHUB_ANCHOR_REPO", "ENGRAM_ALERT_EMAILS", "CHECKPOINT_BUDGET_MS"],
  sentinel: [...SHARED, ...KEYS, "GITHUB_ANCHOR_REPO", "ENGRAM_ALERT_EMAILS", "SENTINEL_BUDGET_MS", ...MODEL],
  labeler: [...SHARED, ...MODEL],
  reflect: [...SHARED, ...MODEL, "REFLECT_BUDGET_MS"],
};
/** Missing any of these fails the deploy. CP_PRIVATE_KEY is checked separately (required only when the Function has none). */
export const REQUIRED: Record<string, string[]> = {
  checkpoint: ["CP_PUBLIC_KEYS", "NEXT_PUBLIC_APP_URL"],
  sentinel: ["CP_PUBLIC_KEYS", "NEXT_PUBLIC_APP_URL"],
  labeler: [],
  reflect: [],
};
const PUBLIC = new Set(["CP_KEY_ID", "CP_PUBLIC_KEYS", "GITHUB_ANCHOR_REPO"]);
export const isSecret = (name: string) => !PUBLIC.has(name) && !name.startsWith("NEXT_PUBLIC_") && /KEY|TOKEN|SECRET/.test(name);

export interface ExistingVar { $id: string; key: string; value: string; secret?: boolean }
export type VarAction =
  | { kind: "create" | "update"; key: string; value: string; secret: boolean; variableId?: string }
  | { kind: "delete"; key: string; variableId: string }
  | { kind: "keep"; key: string; reason: string };

/**
 * When each action runs relative to `createDeployment`. Writes go first, because the code being deployed may need
 * them; deletions go last, so a deployment that fails never leaves the Function running its old code with the
 * variables that code still reads already pruned.
 */
export type DeleteAction = Extract<VarAction, { kind: "delete" }>;
export function splitActions(actions: VarAction[]): { beforeDeploy: Exclude<VarAction, DeleteAction>[]; afterDeploy: DeleteAction[] } {
  return {
    beforeDeploy: actions.filter((a): a is Exclude<VarAction, DeleteAction> => a.kind !== "delete"),
    afterDeploy: actions.filter((a): a is DeleteAction => a.kind === "delete"),
  };
}

/** The values a deploy sets: the environment, with CP_KEY_ID defaulted and CP_PUBLIC_KEYS normalised from every source. */
export function deployEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const keyId = env.CP_KEY_ID?.trim() || DEFAULT_KEY_ID;
  const ring = { ...parseKeyring(env.NEXT_PUBLIC_CP_PUBLIC_KEYS), ...parseKeyring(env.CP_PUBLIC_KEYS), ...parseKeyring(null, env.NEXT_PUBLIC_CP_PUBLIC_KEY?.trim(), keyId) };
  const list = Object.entries(ring).map(([id, hex]) => `${id}:${hex}`).join(",");
  return { ...env, CP_KEY_ID: keyId, CP_PUBLIC_KEYS: list || undefined };
}

export async function planVariables(fnId: string, rawEnv: Record<string, string | undefined>, existing: ExistingVar[], opts: { rotateKey?: boolean; currentKeyId?: string } = {}): Promise<{ actions: VarAction[]; errors: string[] }> {
  const env = deployEnv(rawEnv);
  const names = VARS[fnId] ?? SHARED;
  const errors: string[] = [];
  const actions: VarAction[] = [];
  const found = (k: string) => existing.find((v) => v.key === k);
  for (const k of REQUIRED[fnId] ?? []) if (!env[k]) errors.push(`${fnId}: ${k} is required${k === "CP_PUBLIC_KEYS" ? " (or NEXT_PUBLIC_CP_PUBLIC_KEY with CP_KEY_ID)" : ""}.`);
  const ring = parseKeyring(env.CP_PUBLIC_KEYS);
  if (names.includes("CP_PUBLIC_KEYS") && env.CP_PUBLIC_KEYS && !ring[env.CP_KEY_ID!]) errors.push(`${fnId}: CP_PUBLIC_KEYS has no key for CP_KEY_ID ${env.CP_KEY_ID}.`);

  let keyIdChangeAllowed = false;
  if (names.includes("CP_PRIVATE_KEY")) {
    const have = found("CP_PRIVATE_KEY");
    const current = opts.currentKeyId ?? (found("CP_KEY_ID")?.secret ? undefined : found("CP_KEY_ID")?.value) ?? undefined;
    const newKey = env.CP_PRIVATE_KEY?.trim();
    const matchesRing = async () => {
      if (!newKey) return false;
      try { return (await publicKeyFromPrivate(newKey)) === ring[env.CP_KEY_ID!]; } catch { return false; }
    };
    if (!have) {
      if (!newKey) errors.push(`${fnId}: CP_PRIVATE_KEY is required: the Function has no signing key yet.`);
      else if (!(await matchesRing())) errors.push(`${fnId}: CP_PRIVATE_KEY does not match the public key listed for ${env.CP_KEY_ID} in CP_PUBLIC_KEYS.`);
      else { actions.push({ kind: "create", key: "CP_PRIVATE_KEY", value: newKey, secret: true }); keyIdChangeAllowed = true; }
    } else if (opts.rotateKey) {
      if (!newKey) errors.push(`${fnId}: --rotate-key needs the new CP_PRIVATE_KEY.`);
      else if (!current) errors.push(`${fnId}: --rotate-key cannot read the current CP_KEY_ID; pass --current-key-id=<id>.`);
      else if (current === env.CP_KEY_ID) errors.push(`${fnId}: --rotate-key needs a new CP_KEY_ID (still ${current}).`);
      else if (!ring[current]) errors.push(`${fnId}: CP_PUBLIC_KEYS must keep the old key ${current}, or checkpoints signed before the rotation stop verifying.`);
      else if (!(await matchesRing())) errors.push(`${fnId}: CP_PRIVATE_KEY does not match the public key listed for ${env.CP_KEY_ID} in CP_PUBLIC_KEYS.`);
      else { actions.push({ kind: "update", key: "CP_PRIVATE_KEY", value: newKey, secret: true, variableId: have.$id }); keyIdChangeAllowed = true; }
    } else {
      actions.push({ kind: "keep", key: "CP_PRIVATE_KEY", reason: newKey ? "the Function already has a signing key; CP_PRIVATE_KEY from the environment is ignored (use --rotate-key)" : "existing signing key kept" });
      if (current && current !== env.CP_KEY_ID) errors.push(`${fnId}: CP_KEY_ID would change from ${current} to ${env.CP_KEY_ID} while the signing key stays; change it only with --rotate-key.`);
    }
  }

  for (const k of names) {
    if (k === "CP_PRIVATE_KEY") continue;
    const value = env[k];
    if (!value) continue;
    const cur = found(k);
    if (k === "CP_KEY_ID" && names.includes("CP_PRIVATE_KEY") && !keyIdChangeAllowed && cur) {
      // The signing key stays, so its ID must too. A secret (unreadable) ID is left as it is.
      if (cur.secret && !opts.currentKeyId) { actions.push({ kind: "keep", key: k, reason: "stored as a secret; it changes only with --rotate-key" }); continue; }
      if ((opts.currentKeyId ?? cur.value) !== value) continue; // reported above
    }
    // Appwrite cannot turn a secret variable back into a readable one; keep it secret.
    const secret = isSecret(k) || !!cur?.secret;
    actions.push(cur ? { kind: "update", key: k, value, secret, variableId: cur.$id } : { kind: "create", key: k, value, secret });
  }
  for (const v of existing) {
    if (v.key === "CP_PRIVATE_KEY" || names.includes(v.key)) continue;
    actions.push({ kind: "delete", key: v.key, variableId: v.$id });
  }
  return { actions, errors };
}
