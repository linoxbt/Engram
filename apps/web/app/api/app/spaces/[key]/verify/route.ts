import { verifyAndRecord } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 60;
/** Server-side verification that also refreshes the space's integrity badge. */
export const POST = spaceRoute(async (ctx, _a, req) => verifyAndRecord(ctx.b, ctx.space, req.nextUrl.searchParams.get("mode") === "deep" ? "deep" : "standard"));
