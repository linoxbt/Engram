import { timeline } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, _a, req) => {
  const q = req.nextUrl.searchParams;
  const cursor = q.get("cursor") ?? undefined;
  return timeline(ctx, { subject: q.get("subject") ?? "", limit: 500, ...(cursor ? { cursor } : {}) });
});
