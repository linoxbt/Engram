import { verifyThrottled } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 60;
/** At most one verification per space per minute; calls in between get its result (see verifyThrottled). */
export const GET = agentRoute("verify", async (ctx, req) => {
  const mode = req.nextUrl.searchParams.get("mode") === "deep" ? "deep" : "standard";
  return verifyThrottled(ctx, { mode, id: req.nextUrl.searchParams.get("id") ?? undefined });
});
