import { resolveConflict } from "@engram/server";
import { agentRoute, readJson } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = agentRoute("resolve", async (ctx, req) => resolveConflict(ctx, await readJson(req)));
