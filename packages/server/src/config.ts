/** Environment configuration. Read once; every value has a safe default. */

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
    labelerFunctionId: string | null;
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
  checkpoint: { privateKey: string | null; publicKey: string | null; keyId: string };
  anchor: { token: string | null; repo: string | null };
  seedAdminToken: string | null;
  cronSecret: string | null;
  appUrl: string;
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
  const backend = backendEnv === "local" || backendEnv === "appwrite" ? backendEnv : missing.length ? (production ? "appwrite" : "local") : "appwrite";
  const configError = backend === "appwrite" && missing.length
    ? `Engram is not configured: set ${missing.join(", ")} (or ENGRAM_BACKEND=local for a throwaway demo).`
    : null;
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
      labelerFunctionId: env("LABELER_FUNCTION_ID"),
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
      publicKey: env("NEXT_PUBLIC_CP_PUBLIC_KEY") ?? env("CP_PUBLIC_KEY"),
      keyId: env("CP_KEY_ID") ?? "engram-cp-1",
    },
    anchor: { token: env("GITHUB_ANCHOR_TOKEN"), repo: env("GITHUB_ANCHOR_REPO") },
    seedAdminToken: env("SEED_ADMIN_TOKEN"),
    cronSecret: env("CRON_SECRET"),
    appUrl: env("NEXT_PUBLIC_APP_URL") ?? env("APP_URL") ?? "http://localhost:3000",
    dims: { memories: 768, concepts: 768, agents: 384, recalls: 768 },
  };
  return cached;
}

/** Tests and scripts can override configuration. */
export function setConfig(patch: Partial<EngramConfig>): EngramConfig {
  cached = { ...getConfig(), ...patch };
  return cached;
}
export function resetConfig() { cached = null; }
