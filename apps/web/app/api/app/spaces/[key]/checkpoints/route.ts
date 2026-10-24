import { loadCheckpoints, requestCheckpoint } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = spaceRoute(async (ctx) => ({ checkpoints: await loadCheckpoints(ctx.b, ctx.space.key) }));
/** Seal now: sign a checkpoint at the current head. */
export const POST = spaceRoute(async (ctx) => requestCheckpoint(ctx));
