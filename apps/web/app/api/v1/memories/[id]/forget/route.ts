import { forget } from "@engram/server";
import { agentRoute, readJson } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = agentRoute<{ id: string }>("forget", async (ctx, req, { id }) => {
  const body = await readJson<{ reason?: string }>(req);
  return forget(ctx, { id, reason: body.reason });
});
