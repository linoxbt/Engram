/**
 * Shared bootstrap for Engram's Appwrite Functions. Appwrite injects the
 * endpoint and project ID; the API key comes from APPWRITE_API_KEY or, on
 * runtimes with dynamic keys, the x-appwrite-key request header.
 */
import { createAppwriteBackend, getConfig, setBackend, setConfig, type Backend } from "@engram/server";

export interface FnContext {
  req: { body?: unknown; bodyText?: string; bodyJson?: unknown; headers: Record<string, string | undefined> };
  res: { json: (data: unknown, status?: number) => unknown; text: (s: string, status?: number) => unknown };
  log: (msg: unknown) => void;
  error: (msg: unknown) => void;
}

export function boot(ctx: FnContext): Backend {
  const env = process.env;
  setConfig({
    backend: "appwrite",
    appwrite: {
      ...getConfig().appwrite,
      endpoint: env.APPWRITE_ENDPOINT ?? env.APPWRITE_FUNCTION_API_ENDPOINT ?? "",
      projectId: env.APPWRITE_PROJECT_ID ?? env.APPWRITE_FUNCTION_PROJECT_ID ?? "",
      apiKey: env.APPWRITE_API_KEY ?? ctx.req.headers["x-appwrite-key"] ?? "",
    },
  });
  const b = createAppwriteBackend(getConfig());
  setBackend(b);
  return b;
}

export function body(ctx: FnContext): Record<string, unknown> {
  const raw = ctx.req.bodyJson ?? ctx.req.body ?? ctx.req.bodyText;
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

/** Structured JSON logs, one line per event. */
export const logJson = (ctx: FnContext, event: string, data: Record<string, unknown>) => ctx.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
