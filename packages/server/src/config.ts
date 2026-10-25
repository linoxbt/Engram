/** Environment configuration. Read once; every value has a safe default. */
import { parseKeyring } from "@engram/core";

/** Same format as `pnpm keygen` (engram-cp-YYYY-MM) and the browser's default for the legacy key. */
export const DEFAULT_KEY_ID = "engram-cp-2026-10";

export interface EngramConfig {
  backend: "appwrite" | "local";
  /** Set when production would otherwise fall back to the local backend; getBackend() refuses to start. */
  configError: string | null;
  /** Return email links in API responses (local backend in development, or ENGRAM_DEV_LINKS=true). */
  devLinks: boolean;
  appwrite: {
    endpoint: string;
    projectId: string;
    apiKey: string;
    databaseId: string;
    checkpointsBucket: string;
    exportsBucket: string;
    checkpointFunctionId: string | null;
  };
  /** Combine vector queries with metadata filters in one request (Day 1 experiment 2). */
  vectorFilters: boolean;
  /** Apply nomic task prefixes (search_document:, search_query:). */
  embedPrefixes: boolean;
  localDataDir: string;
  classifierModel: string | null;
  /** Models a space owner may choose (CLASSIFIER_MODELS, comma-separated, plus CLASSIFIER_MODEL). The operator pays for every call. */
  allowedModels: string[];
  modelApiKey: string | null;
  /** Required by Anthropic for keys that are not scoped to a workspace. */
  anthropicWorkspaceId: string | null;
  checkpoint: {
    privateKey: string | null;
    /** The current signing key's public half (legacy single-key setting), listed in the keyring under `keyId`. */
    publicKey: string | null;
    keyId: string;
    /**
     * Every checkpoint public key ever used, by keyId (CP_PUBLIC_KEYS and NEXT_PUBLIC_CP_PUBLIC_KEYS, "keyId:hex,...").
     * Server-side verification uses `keyringOf(cfg)`, which adds the legacy key and never falls back to a keyless check.
     */
    publicKeys?: Record<string, string>;
  };
  anchor: { token: string | null; repo: string | null };
  seedAdminToken: string | null;
  cronSecret: string | null;
  /** Public base URL for links in emails and proofs. Null in production when unset: links are left out, never pointed at localhost. */
  appUrl: string | null;
  dims: { memories: number; concepts: number; agents: number; recalls: number };
}

const env = (k: string) => {
  const v = typeof process !== "undefined" ? process.env[k] : undefined;
  return v && v.trim() ? v.trim() : null;
};
/** The one boolean env parser: 1/true/yes/on (any case) is true; unset falls back to `d`. */
export const bool = (k: string, d: boolean) => {
  const v = env(k);
  return v == null ? d : /^(1|true|yes|on)$/i.test(v);
};

let cached: EngramConfig | null = null;

export function getConfig(): EngramConfig {
  if (cached) return cached;
  const endpoint = env("APPWRITE_ENDPOINT") ?? "";
  const backendEnv = env("ENGRAM_BACKEND");
  const production = env("NODE_ENV") === "production";
  const missing = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"].filter((k) => !env(k));
  // Appwrite when configured. Without it the local backend keeps every screen working in development, but
  // production must ask for it explicitly: an ephemeral per-instance store silently losing accounts is worse than an error.
  const knownBackend = backendEnv === null || backendEnv === "local" || backendEnv === "appwrite";
  const backend = backendEnv === "local" || backendEnv === "appwrite" ? backendEnv : missing.length ? (production || !knownBackend ? "appwrite" : "local") : "appwrite";
  // A typo must not silently pick a backend: getBackend() refuses to start with this error.
  const configError = !knownBackend
    ? `ENGRAM_BACKEND must be "appwrite" or "local", not "${backendEnv}".`
    : backend === "appwrite" && missing.length
      ? `Engram is not configured: set ${missing.join(", ")} (or ENGRAM_BACKEND=local for a throwaway demo).`
      : null;
  const keyId = env("CP_KEY_ID") ?? env("NEXT_PUBLIC_CP_KEY_ID") ?? DEFAULT_KEY_ID;
  const publicKey = env("NEXT_PUBLIC_CP_PUBLIC_KEY") ?? env("CP_PUBLIC_KEY");
  cached = {
    backend,
    configError,
    devLinks: backend === "local" && (!production || bool("ENGRAM_DEV_LINKS", false)),
    appwrite: {
      endpoint,
      projectId: env("APPWRITE_PROJECT_ID") ?? "",
      apiKey: env("APPWRITE_API_KEY") ?? "",
      databaseId: env("APPWRITE_DB_ID") ?? "engram",
      checkpointsBucket: env("APPWRITE_CHECKPOINTS_BUCKET") ?? "checkpoints",
      // One bucket by default (the Free plan allows one); exports are stored as ex_* files beside checkpoints.
      exportsBucket: env("APPWRITE_EXPORTS_BUCKET") ?? env("APPWRITE_CHECKPOINTS_BUCKET") ?? "checkpoints",
      checkpointFunctionId: env("CHECKPOINT_FUNCTION_ID"),
    },
    vectorFilters: bool("ENGRAM_VECTOR_FILTERS", true),
    embedPrefixes: bool("ENGRAM_EMBED_PREFIXES", true),
    // Serverless filesystems are read-only outside /tmp; there the local backend is ephemeral.
    localDataDir: env("ENGRAM_LOCAL_DIR") ?? (env("AWS_LAMBDA_FUNCTION_NAME") || env("NETLIFY") ? "/tmp/engram-local" : ".engram-local"),
    classifierModel: env("CLASSIFIER_MODEL"),
    allowedModels: [...new Set([env("CLASSIFIER_MODEL"), ...(env("CLASSIFIER_MODELS") ?? "").split(",").map((x) => x.trim())].filter((x): x is string => !!x))],
    modelApiKey: env("MODEL_API_KEY"),
    anthropicWorkspaceId: env("ANTHROPIC_WORKSPACE_ID"),
    checkpoint: {
      privateKey: env("CP_PRIVATE_KEY"),
      publicKey,
      keyId,
      publicKeys: { ...parseKeyring(env("NEXT_PUBLIC_CP_PUBLIC_KEYS")), ...parseKeyring(env("CP_PUBLIC_KEYS")) },
    },
    anchor: { token: env("GITHUB_ANCHOR_TOKEN"), repo: env("GITHUB_ANCHOR_REPO") },
    seedAdminToken: env("SEED_ADMIN_TOKEN"),
    cronSecret: env("CRON_SECRET"),
    // Netlify sets URL to the site's primary address. Localhost only in development.
    appUrl: env("NEXT_PUBLIC_APP_URL") ?? env("APP_URL") ?? (env("NETLIFY") ? env("URL") : null) ?? (production ? null : "http://localhost:3000"),
    dims: { memories: 768, concepts: 768, agents: 384, recalls: 768 },
  };
  return cached;
}

/**
 * The keyring every server-side verification uses (sentinel, signer, /verify, proofs): CP_PUBLIC_KEYS plus the legacy
 * single key under its keyId. A checkpoint is checked with the key its keyId names; an unknown keyId is critical.
 */
export function keyringOf(cfg: EngramConfig): Record<string, string> {
  const ring = { ...(cfg.checkpoint.publicKeys ?? {}) };
  const legacy = cfg.checkpoint.publicKey;
  if (legacy && /^[0-9a-f]{64}$/.test(legacy) && !ring[cfg.checkpoint.keyId]) ring[cfg.checkpoint.keyId] = legacy;
  return ring;
}

/** Scheduled Functions time out at 300 s; a run must stop starting new work well before that. */
export const SCHEDULE_TIMEOUT_MS = 300_000;
export const DEFAULT_BUDGET_MS = 240_000;
export const MAX_BUDGET_MS = 270_000;

/** A time budget from an env value (milliseconds), defaulting to 240 s and never above 270 s. */
export function scheduleBudgetMs(raw?: string | number | null): number {
  const n = typeof raw === "number" ? raw : raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BUDGET_MS) : DEFAULT_BUDGET_MS;
}

/** Tests and scripts can override configuration. */
export function setConfig(patch: Partial<EngramConfig>): EngramConfig {
  cached = { ...getConfig(), ...patch };
  return cached;
}
export function resetConfig() { cached = null; }
