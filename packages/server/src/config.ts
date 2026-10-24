/** Environment configuration. Read once; every value has a safe default. */

export interface EngramConfig {
  backend: "appwrite" | "local";
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
const bool = (k: string, d: boolean) => {
  const v = env(k);
  return v == null ? d : /^(1|true|yes|on)$/i.test(v);
};

let cached: EngramConfig | null = null;

export function getConfig(): EngramConfig {
  if (cached) return cached;
  const endpoint = env("APPWRITE_ENDPOINT") ?? "";
  const backendEnv = env("ENGRAM_BACKEND");
  cached = {
    // Appwrite only when it is fully configured; otherwise the local backend keeps every screen working.
    backend: backendEnv === "local" || backendEnv === "appwrite" ? backendEnv : endpoint && env("APPWRITE_PROJECT_ID") && env("APPWRITE_API_KEY") ? "appwrite" : "local",
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
