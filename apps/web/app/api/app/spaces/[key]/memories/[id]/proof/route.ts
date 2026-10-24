import { proofFor } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => proofFor(ctx.b, ctx.space, id));
