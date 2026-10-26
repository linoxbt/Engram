import { verifyAndRecord } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
/** Server-side verification that also refreshes the space's integrity badge. Full-chain work: capped per person. */
export const POST = spaceRoute(async (ctx, access, req) => {
  rateLimit("space-verify", `${access.user.id}:${ctx.space.key}`, 12, 5 * MINUTE, "This space was just verified. Try again in a moment.");
  return verifyAndRecord(ctx.b, ctx.space, req.nextUrl.searchParams.get("mode") === "deep" ? "deep" : "standard");
});
