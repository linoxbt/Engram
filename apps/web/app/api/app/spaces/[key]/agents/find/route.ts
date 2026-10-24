import { findAgentsByCapability } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, _a, req) => ({ agents: await findAgentsByCapability(ctx.b, ctx.space.key, req.nextUrl.searchParams.get("q") ?? "", 3) }));
