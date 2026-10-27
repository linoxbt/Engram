import { reflect } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { limitSpaceWork } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = spaceRoute<{ key: string; id: string }>(async (ctx, access, _r, { id }) => {
  limitSpaceWork("reflect", access.user.id, ctx.space.key);
  return reflect(ctx, id);
});
