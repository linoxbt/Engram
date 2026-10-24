import { timeline } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = agentRoute<{ subject: string }>("recall", async (ctx, req, { subject }) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  return timeline(ctx, { subject: decodeURIComponent(subject), limit });
});
