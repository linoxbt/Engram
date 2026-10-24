import { forget } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = spaceRoute<{ key: string; id: string }>(async (ctx, _a, req, { id }) => {
  const body = await readJson<{ reason?: string }>(req);
  return forget(ctx, { id, reason: body.reason });
});
