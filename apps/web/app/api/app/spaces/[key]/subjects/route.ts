import { subjectsOverview } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
// Maintained incrementally per process (only entries after the cached head are read), not a full chain read per call.
export const GET = spaceRoute(async (ctx) => subjectsOverview(ctx));
