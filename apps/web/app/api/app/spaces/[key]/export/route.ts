import { exportSpace } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { HOUR, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = spaceRoute(async (ctx, access) => {
  rateLimit("export", `${access.user.id}:${ctx.space.key}`, 10, HOUR, "Too many exports of this space.");
  const doc = await exportSpace(ctx, { owner: access.owner });
  return new Response(JSON.stringify(doc, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="engram-${ctx.space.key}-${doc.exportedAt.slice(0, 10)}.json"` },
  });
});
