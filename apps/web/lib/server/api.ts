import "server-only";
import { after, NextResponse, type NextRequest } from "next/server";
import { authAgent, getBackend, personCtx, requireScope, toErrorBody, EngramError, type Ctx, type Scope } from "@engram/server";
import { requireSpaceAccess, type SpaceAccess } from "./session";

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

/** `after()` keeps the function alive for post-commit work on serverless hosts. */
export const defer = (task: () => Promise<unknown>) => {
  after(() => task().catch((e) => console.error("[engram] background task failed", e)));
};

export function errorResponse(e: unknown) {
  const { status, body } = toErrorBody(e);
  return NextResponse.json(body, { status });
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

/** Agent-key routes under /api/v1. */
export function agentRoute<P = Record<string, string>>(scope: Scope | null, fn: (ctx: Ctx, req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, { params }: Params<P>) => {
    try {
      const ctx = await authAgent(getBackend(), req.headers.get("authorization"), defer);
      if (scope) requireScope(ctx, scope);
      return json(await fn(ctx, req, await params));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Session routes for the dashboard under /api/app/spaces/[key]. */
export function spaceRoute<P extends { key: string } = { key: string }>(fn: (ctx: Ctx, access: SpaceAccess, req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, { params }: Params<P>) => {
    try {
      const p = await params;
      const access = await requireSpaceAccess(p.key);
      const ctx = personCtx(getBackend(), access.space, access.user, defer);
      const out = await fn(ctx, access, req, p);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Anything else: wraps errors consistently. */
export function route<P = Record<string, string>>(fn: (req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Params<P>) => {
    try {
      const out = await fn(req, await ctx.params);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function requireOwner(access: SpaceAccess) {
  if (!access.owner) throw new EngramError("forbidden", "Only the space owner can do this.");
}
