import { feed, parseLimit, parseSeqParam } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, _a, req) => {
  const sp = req.nextUrl.searchParams;
  return { items: await feed(ctx, { limit: parseLimit(sp.get("limit"), 30, 100), after: parseSeqParam("after", sp.get("after")) }) };
});
