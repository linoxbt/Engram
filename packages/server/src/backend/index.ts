import { getConfig } from "../config";
import { EngramError } from "../errors";
import { createAppwriteBackend } from "./appwrite";
import { createLocalBackend } from "./local";
import type { Backend } from "./types";

export * from "./types";
export { createLocalBackend, hashEmbed, HashEmbedder } from "./local";
export { createAppwriteBackend } from "./appwrite";
export { reserveSlot, type AttemptStore } from "./login-guard";

const KEY = Symbol.for("engram.backend");
type G = typeof globalThis & { [KEY]?: Backend };

/** Process-wide backend (survives Next.js hot reloads). */
export function getBackend(): Backend {
  const g = globalThis as G;
  if (!g[KEY]) {
    const cfg = getConfig();
    if (cfg.configError) throw new EngramError("unavailable", cfg.configError);
    g[KEY] = cfg.backend === "appwrite" ? createAppwriteBackend(cfg) : createLocalBackend({ dir: cfg.localDataDir });
  }
  return g[KEY]!;
}
export function setBackend(b: Backend) { (globalThis as G)[KEY] = b; }
