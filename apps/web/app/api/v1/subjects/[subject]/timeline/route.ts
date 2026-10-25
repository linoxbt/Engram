import { timeline } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = agentRoute<{ subject: string }>("recall", async (ctx, req, { subject }) => {
  const q = req.nextUrl.searchParams;
  const cursor = q.get("cursor") ?? undefined;
  return timeline(ctx, { subject: decodeURIComponent(subject), limit: Number(q.get("limit") ?? 100), ...(cursor ? { cursor } : {}) });
});
