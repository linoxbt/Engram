/**
 * Throwaway Ed25519 checkpoint keys for end-to-end runs, kept in node_modules/.cache so the same pair is seen by
 * `pnpm build` (which inlines NEXT_PUBLIC_CP_PUBLIC_KEYS into the browser verifier) and by the Playwright web server
 * (which signs with the private key). Never used outside tests.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const E2E_KEY_ID = "e2e";
/** Found from the working directory (the repo root for scripts, apps/web for Playwright); no import.meta, so CJS-compiled configs can use it. */
function repoRoot(): string {
  for (let d = resolve(process.cwd()); ; d = dirname(d)) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    if (dirname(d) === d) return resolve(process.cwd());
  }
}
export const E2E_KEYS_FILE = join(repoRoot(), "apps/web/node_modules/.cache/engram-e2e/keys.json");

export interface E2EKeys { keyId: string; privateKey: string; publicKey: string }

export function e2eKeys(opts: { fresh?: boolean } = {}): E2EKeys {
  if (!opts.fresh && existsSync(E2E_KEYS_FILE)) {
    try { const k = JSON.parse(readFileSync(E2E_KEYS_FILE, "utf8")) as E2EKeys; if (/^[0-9a-f]{64}$/.test(k.publicKey) && /^[0-9a-f]{64}$/.test(k.privateKey)) return k; } catch { /* regenerate */ }
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = (der: Buffer) => der.subarray(der.length - 32).toString("hex");
  const keys = { keyId: E2E_KEY_ID, privateKey: raw(privateKey.export({ format: "der", type: "pkcs8" }) as Buffer), publicKey: raw(publicKey.export({ format: "der", type: "spki" }) as Buffer) };
  mkdirSync(dirname(E2E_KEYS_FILE), { recursive: true });
  writeFileSync(E2E_KEYS_FILE, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

/** What the build needs to pin the key (public values only). */
export const buildEnv = (k: E2EKeys) => ({ NEXT_PUBLIC_CP_PUBLIC_KEYS: `${k.keyId}:${k.publicKey}`, NEXT_PUBLIC_CP_KEY_ID: k.keyId });
