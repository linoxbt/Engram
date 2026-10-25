import { revokeInvite } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";

export const DELETE = spaceRoute<{ key: string; id: string }>(async (ctx, access, _req, { id }) => {
  requireOwner(access);
  await revokeInvite(ctx.b, ctx.space.key, id);
  return { ok: true };
});
