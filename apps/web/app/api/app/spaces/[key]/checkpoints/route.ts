import { loadCheckpoints, requestCheckpoint } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { limitSpaceWork } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = spaceRoute(async (ctx) => ({ checkpoints: await loadCheckpoints(ctx.b, ctx.space.key) }));
/** Seal now: sign a checkpoint at the current head. A full-chain Merkle build and a signature, so capped. */
export const POST = spaceRoute(async (ctx, access) => {
  limitSpaceWork("checkpoint", access.user.id, ctx.space.key);
  return requestCheckpoint(ctx);
});
