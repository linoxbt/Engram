import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@engram/server";

/** Per-request facts the route wrappers know and deeper helpers (session checks, deferred work) need. */
export interface RequestInfo {
  reqId: string;
  /** The request path, e.g. /api/auth/me. */
  route: string;
  method: string;
  /** The signed-in user, looked up at most once per request. */
  user?: Promise<User | null>;
}

const KEY = Symbol.for("engram.request-store");
type G = typeof globalThis & { [KEY]?: AsyncLocalStorage<RequestInfo> };
// One store per process even if a bundler loads this module twice.
export const requestStore: AsyncLocalStorage<RequestInfo> = ((globalThis as G)[KEY] ??= new AsyncLocalStorage<RequestInfo>());

export const currentRequest = (): RequestInfo | null => requestStore.getStore() ?? null;
