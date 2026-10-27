import { verifyAndRecord } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
/** Server-side verification that also refreshes the space's integrity badge. Full-chain work: capped per person. */
export const POST = spaceRoute(async (ctx, access, req) => {
  // A read-only viewer gets the badge the monitor last recorded. Running it for them would be a full-chain read,
  // a state write and, on a tampered chain, an email to the owner, all from an account anyone can create.
  if (access.viewer) return { cached: true, integrity: ctx.space.settings.integrity };
  rateLimit("space-verify", `${access.user.id}:${ctx.space.key}`, 12, 5 * MINUTE, "This space was just verified. Try again in a moment.");
  return verifyAndRecord(ctx.b, ctx.space, req.nextUrl.searchParams.get("mode") === "deep" ? "deep" : "standard");
});
