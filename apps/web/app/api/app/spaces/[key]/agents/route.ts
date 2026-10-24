import { createAgent, listAgents, CreateAgentInput } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx) => ({ agents: await listAgents(ctx.b, ctx.space.key) }));
export const POST = spaceRoute(async (ctx, access, req) => {
  const input = CreateAgentInput.parse(await readJson(req));
  return createAgent(ctx.b, ctx.space, input, `user:${access.user.id}`);
});
