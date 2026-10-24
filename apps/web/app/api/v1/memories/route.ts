import { remember } from "@engram/server";
import { agentRoute, readJson } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = agentRoute("remember", async (ctx, req) => remember(ctx, await readJson(req)));
