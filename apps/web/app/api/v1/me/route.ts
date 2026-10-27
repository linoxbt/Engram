import { publicIntegrity } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = agentRoute(null, async (ctx) => ({
  agent: { id: ctx.actor, name: ctx.actorName, scopes: ctx.scopes },
  space: { key: ctx.space.key, name: ctx.space.settings.name },
  integrity: publicIntegrity(ctx.space.settings.integrity),
  latestCheckpoint: ctx.space.settings.latestCheckpoint,
}));
