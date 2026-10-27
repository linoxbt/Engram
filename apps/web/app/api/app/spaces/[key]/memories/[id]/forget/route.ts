import { forget } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";
import { limitSpaceWork } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const POST = spaceRoute<{ key: string; id: string }>(async (ctx, access, req, { id }) => {
  limitSpaceWork("forget", access.user.id, ctx.space.key);
  const body = await readJson<{ reason?: string }>(req);
  return forget(ctx, { id, reason: body.reason });
});
