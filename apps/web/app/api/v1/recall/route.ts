import { recall } from "@engram/server";
import { agentRoute, readJson } from "@/lib/server/api";
import { MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
/** Each recall embeds the query and runs a vector search: capped per agent. */
export const POST = agentRoute("recall", async (ctx, req) => {
  rateLimit("recall-agent", ctx.actor, 120, MINUTE, "Too many recalls from this agent key.");
  return recall(ctx, await readJson(req));
});
