import "server-only";
import { after, NextResponse, type NextRequest } from "next/server";
import { authAgent, errorLogFields, getBackend, personCtx, requireScope, toErrorBody, EngramError, type Ctx, type Scope } from "@engram/server";
import { logError, requestIdFor } from "./log";
import { currentRequest, requestStore, type RequestInfo } from "./request";
import { requireSpaceAccess, type SpaceAccess } from "./session";

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

/** `after()` keeps the function alive for post-commit work on serverless hosts. A failure is logged with the request's ID. */
export const defer = (task: () => Promise<unknown>) => {
  const r = currentRequest();
  after(() => task().catch((e) => {
    const f = errorLogFields(e);
    logError({ reqId: r?.reqId ?? "-", route: r?.route ?? "-", status: f.status >= 500 ? f.status : 500, code: "background_task_failed", message: `${f.code}: ${f.message}` });
  }));
};

export function errorResponse(e: unknown) {
  const { status, body } = toErrorBody(e);
  if (status >= 500) {
    const r = currentRequest();
    const f = errorLogFields(e);
    logError({ reqId: r?.reqId ?? "-", route: r?.route ?? "-", status, code: f.code, message: f.message });
  }
  return NextResponse.json(body, { status });
}

/**
 * Runs a handler with a request ID: every response (errors included) carries `x-request-id`, and a 5xx that a
 * handler returns itself is logged like a thrown one.
 */
async function handle(req: NextRequest, run: (info: RequestInfo) => Promise<Response>): Promise<Response> {
  const info: RequestInfo = { reqId: requestIdFor(req.headers), route: req.nextUrl?.pathname ?? new URL(req.url).pathname, method: req.method };
  return requestStore.run(info, async () => {
    let res: Response;
    let logged = false;
    try { res = await run(info); } catch (e) { res = errorResponse(e); logged = true; }
    if (res.status >= 500 && !logged) logError({ reqId: info.reqId, route: info.route, status: res.status, code: "internal", message: `handler returned ${res.status}` });
    try { res.headers.set("x-request-id", info.reqId); }
    catch { res = new Response(res.body, res); res.headers.set("x-request-id", info.reqId); } // immutable headers (a proxied fetch)
    return res;
  });
}

export async function readJson<T = unknown>(req: NextRequest | Request): Promise<T> {
  const text = await req.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new EngramError("bad_request", "Request body must be valid JSON.");
  }
}

type Params<P> = { params: Promise<P> };

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax already blocks most cross-site posts;
 * this also refuses the ones browsers mark as cross-site (and any with a foreign Origin).
 */
const hostOf = (url?: string) => { try { return url ? new URL(url).host : null; } catch { return null; } };

export function requireSameOrigin(req: NextRequest | Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new EngramError("forbidden", "Cross-site requests are not allowed.");
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let host = "";
    try { host = new URL(origin).host; } catch { host = ""; }
    const own = [req.headers.get("x-forwarded-host"), req.headers.get("host"), hostOf(process.env.NEXT_PUBLIC_APP_URL)];
    if (!host || !own.includes(host)) throw new EngramError("forbidden", "Cross-site requests are not allowed.");
  }
}

/** Agent-key routes under /api/v1. */
export function agentRoute<P = Record<string, string>>(scope: Scope | null, fn: (ctx: Ctx, req: NextRequest, params: P) => Promise<unknown>) {
  return (req: NextRequest, { params }: Params<P>) => handle(req, async () => {
    const ctx = await authAgent(getBackend(), req.headers.get("authorization"), defer);
    if (scope) requireScope(ctx, scope);
    return json(await fn(ctx, req, await params));
  });
}

/** Session routes for the dashboard under /api/app/spaces/[key]. */
export function spaceRoute<P extends { key: string } = { key: string }>(fn: (ctx: Ctx, access: SpaceAccess, req: NextRequest, params: P) => Promise<unknown>) {
  return (req: NextRequest, { params }: Params<P>) => handle(req, async () => {
    requireSameOrigin(req);
    const p = await params;
    const access = await requireSpaceAccess(p.key);
    const ctx = personCtx(getBackend(), access.space, access.user, defer);
    const out = await fn(ctx, access, req, p);
    return out instanceof Response ? out : json(out);
  });
}

/** Anything else: wraps errors consistently. */
export function route<P = Record<string, string>>(fn: (req: NextRequest, params: P) => Promise<unknown>) {
  return (req: NextRequest, ctx: Params<P>) => handle(req, async () => {
    requireSameOrigin(req);
    const out = await fn(req, await ctx.params);
    return out instanceof Response ? out : json(out);
  });
}

export function requireOwner(access: SpaceAccess) {
  if (!access.owner) throw new EngramError("forbidden", "Only the space owner can do this.");
}
