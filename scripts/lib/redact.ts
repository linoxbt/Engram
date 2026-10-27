/**
 * Redaction for anything provisioning prints or records. Two layers:
 *  1. the literal values of every secret-looking environment variable, and
 *  2. generic patterns for credentials that may not be in this environment at all (agent keys minted by a seed,
 *     Appwrite keys and JWTs echoed by an SDK error, model keys, webhook URLs, tokens in query strings).
 * Public keys and NEXT_PUBLIC_* values are left alone: they are not secret and the report needs them.
 */

/** Variables that are always secret, whatever their name looks like. */
export const SECRET_VARS = [
  "APPWRITE_API_KEY", "APPWRITE_TEST_KEY", "MODEL_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CP_PRIVATE_KEY",
  "GITHUB_ANCHOR_TOKEN", "CRON_SECRET", "SEED_ADMIN_TOKEN", "ERROR_WEBHOOK_URL", "ENGRAM_KEY",
];
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|WEBHOOK|PRIVATE|CREDENTIAL/i;
const PUBLIC_NAME = /^NEXT_PUBLIC_|PUBLIC_KEY|PUBKEY|_KEY_ID$|^CP_PUBLIC_KEYS$/;

/** Names of environment variables whose values must never appear in output. */
export function secretNames(env: Record<string, string | undefined>): string[] {
  const names = new Set(SECRET_VARS);
  for (const k of Object.keys(env)) if (SECRET_NAME.test(k) && !PUBLIC_NAME.test(k)) names.add(k);
  return [...names];
}

const PATTERNS: [RegExp, string][] = [
  // Engram agent keys: eng_<prefix>_<secret>.
  [/\beng_[A-Za-z0-9]{4}_[A-Za-z0-9]{8,}/g, "eng_****_<agent key>"],
  // Appwrite API keys ("standard_<hex>") and dynamic Function keys.
  [/\b(standard|dynamic)_[A-Za-z0-9]{16,}/g, "<appwrite key>"],
  // JWTs (Appwrite session JWTs, Realtime JWTs).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt>"],
  // Model provider keys. Anthropic first, so the generic sk- rule does not leave a tail.
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "<anthropic key>"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "<openai key>"],
  // GitHub tokens.
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "<github token>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "<github token>"],
  // Incoming-webhook URLs carry their secret in the path.
  [/https?:\/\/hooks\.slack\.com\/[^\s"'<>)]+/gi, "<slack webhook>"],
  [/https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>)]+/gi, "<discord webhook>"],
  // Credentials in a URL's userinfo: https://user:pass@host.
  [/(https?:\/\/)[^\s/@:"']+:[^\s/@"']+@/gi, "$1<credentials>@"],
  // Token-bearing query parameters.
  [/([?&](?:token|access_token|key|api_key|apikey|secret|sig|signature|password|jwt|code)=)[^&\s"'<>]+/gi, "$1<redacted>"],
  // JSON fields that hold secrets ("secret": "...", "apiKey": "...", "privateKey": "...").
  [/("(?:secret|password|apiKey|api_key|privateKey|private_key|token|jwt|sessionSecret)"\s*:\s*")[^"]*(")/gi, "$1<redacted>$2"],
  // Headers echoed in errors.
  [/((?:x-appwrite-key|authorization|x-api-key)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',}]+/gi, "$1<redacted>"],
];

/**
 * A bare 64-character hex string: the shape of an Ed25519 checkpoint signing key (`pnpm keygen`). Its public half
 * and a SHA-256 hash look exactly the same, so this runs last and skips the public keys this environment knows —
 * the report has to carry those. No provisioning step prints a hash, so the remaining false-positive risk is small
 * next to publishing a signing key in a build log.
 */
const HEX64 = /\b[0-9a-f]{64}\b/gi;

/** Every 64-hex value in the non-secret (public-key) variables, which the hex rule must leave readable. */
function publicHex(env: Record<string, string | undefined>): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(env)) {
    if (!v || !PUBLIC_NAME.test(k)) continue;
    for (const m of v.matchAll(HEX64)) out.add(m[0].toLowerCase());
  }
  return out;
}

export function makeRedactor(env: Record<string, string | undefined>) {
  // Read `env` on every call rather than snapshotting it: provisioning generates CP_PRIVATE_KEY into this same
  // object long after the redactor is built, and a snapshot taken before that would not know the new key's value.
  const values = () => secretNames(env)
    .map((k) => [k, env[k]] as const)
    .filter((kv): kv is readonly [string, string] => typeof kv[1] === "string" && kv[1].trim().length >= 8)
    // Longest first, so a value that contains another is replaced whole.
    .sort((a, b) => b[1].length - a[1].length);
  return (text: string): string => {
    let out = String(text);
    for (const [k, v] of values()) out = out.split(v.trim()).join(`<${k}>`);
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    const known = publicHex(env);
    return out.replace(HEX64, (hex) => (known.has(hex.toLowerCase()) ? hex : "<hex key>"));
  };
}

/** Redact every string inside a JSON-able value. */
export function redactDeep<T>(value: T, redact: (s: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redact(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
