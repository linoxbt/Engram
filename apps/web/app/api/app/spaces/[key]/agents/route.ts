import { createAgent, listAgents, CreateAgentInput } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";
import { HOUR, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx) => ({ agents: await listAgents(ctx.b, ctx.space.key) }));
/** Keys write to the space with no person attached, so only the owner issues them. */
export const POST = spaceRoute(async (ctx, access, req) => {
  requireOwner(access);
  rateLimit("agent-key-user", access.user.id, 30, HOUR, "Too many agent keys created.");
  const input = CreateAgentInput.parse(await readJson(req));
  return createAgent(ctx.b, ctx.space, input, `user:${access.user.id}`);
});
