import { verifyTool } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = agentRoute("verify", async (ctx, req) => {
  const mode = req.nextUrl.searchParams.get("mode") === "deep" ? "deep" : "standard";
  return verifyTool(ctx, { mode, id: req.nextUrl.searchParams.get("id") ?? undefined });
});
