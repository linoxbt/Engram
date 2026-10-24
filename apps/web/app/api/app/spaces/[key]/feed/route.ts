import { feed } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, _a, req) => {
  const after = req.nextUrl.searchParams.get("after");
  return { items: await feed(ctx, { limit: Number(req.nextUrl.searchParams.get("limit") ?? 30), after: after == null ? undefined : Number(after) }) };
});
