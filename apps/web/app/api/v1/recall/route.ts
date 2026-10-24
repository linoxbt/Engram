import { recall } from "@engram/server";
import { agentRoute, readJson } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = agentRoute("recall", async (ctx, req) => recall(ctx, await readJson(req)));
