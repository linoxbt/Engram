import { timeline } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, _a, req) => timeline(ctx, { subject: req.nextUrl.searchParams.get("subject") ?? "", limit: 500 }));
