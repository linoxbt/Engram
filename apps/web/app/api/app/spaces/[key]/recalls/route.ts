import { listRecalls } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, _a, req) => ({ recalls: await listRecalls(ctx, { limit: 200, agent: req.nextUrl.searchParams.get("agent") ?? undefined }) }));
