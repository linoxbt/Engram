import { revokeAgent } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const DELETE = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => {
  await revokeAgent(ctx.b, ctx.space.key, id);
  return { ok: true };
});
