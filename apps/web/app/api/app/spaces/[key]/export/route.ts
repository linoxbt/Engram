import { exportSpace } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = spaceRoute(async (ctx) => {
  const doc = await exportSpace(ctx);
  return new Response(JSON.stringify(doc, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="engram-${ctx.space.key}-${doc.exportedAt.slice(0, 10)}.json"` },
  });
});
