import { revokeAgent } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const DELETE = spaceRoute<{ key: string; id: string }>(async (ctx, access, _r, { id }) => {
  requireOwner(access);
  await revokeAgent(ctx.b, ctx.space.key, id);
  return { ok: true };
});
