import { listConflicts, resolveConflict } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";
import { limitSpaceWork } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Open conflicts with the stored reason for each pair (`pairs[].reason`) and how it was decided (`pairs[].via`). */
export const GET = spaceRoute(async (ctx) => listConflicts(ctx));

export const POST = spaceRoute(async (ctx, access, req) => {
  limitSpaceWork("conflict", access.user.id, ctx.space.key);
  return resolveConflict(ctx, await readJson(req));
});
