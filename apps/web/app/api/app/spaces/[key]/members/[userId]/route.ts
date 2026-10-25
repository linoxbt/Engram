import { removeMember } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";

export const DELETE = spaceRoute<{ key: string; userId: string }>(async (ctx, access, _req, { userId }) => {
  requireOwner(access);
  await removeMember(ctx.b, ctx.space.key, userId);
  return { ok: true };
});
