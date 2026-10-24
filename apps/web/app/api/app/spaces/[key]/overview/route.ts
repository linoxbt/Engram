import { overview } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx) => overview(ctx));
