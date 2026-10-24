import type { Backend } from "./backend/types";
import type { EngramConfig } from "./config";
import type { SpaceSettings } from "./settings";

export type Scope = "remember" | "recall" | "forget" | "verify" | "resolve";
export const ALL_SCOPES: Scope[] = ["remember", "recall", "forget", "verify", "resolve"];

export interface SpaceInfo { key: string; teamId: string; settings: SpaceSettings }

/** Everything an engine call needs: storage, the space, who is acting, and a way to run work after responding. */
export interface Ctx {
  b: Backend;
  cfg: EngramConfig;
  space: SpaceInfo;
  /** Agent ID (a_...) or "user:<id>" for people acting in the dashboard. */
  actor: string;
  actorName: string;
  scopes: Scope[];
  defer: (task: () => Promise<unknown>) => void;
}

/** Fire-and-forget fallback when the host has no `after()`; errors are logged, never thrown. */
export const backgroundDefer = (task: () => Promise<unknown>) => {
  void task().catch((e) => console.error("[engram] background task failed", e));
};

export const COLLECTION_DIMS = { memories: 768, concepts: 768, agents: 384, recalls: 768 } as const;
export const MEMORY_MODEL = "nomic-embed-text";
export const AGENT_MODEL = "all-minilm";
