import { recall } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
/** People searching in the dashboard are not logged in the agents' recall audit. */
export const POST = spaceRoute(async (ctx, _a, req) => recall(ctx, await readJson(req), { log: false }));
