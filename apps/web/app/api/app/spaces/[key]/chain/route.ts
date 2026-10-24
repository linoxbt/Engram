import { type EntryMeta } from "@engram/core";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";

/** Full entries for the in-browser verifier (members may see text). `vectors=1` for deep mode. */
export const GET = spaceRoute(async (ctx, _a, req) => {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit") ?? 500)));
  const withVectors = sp.get("vectors") === "1";
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }],
    order: { field: "$id", dir: "asc" }, limit, cursorAfter: sp.get("cursor") ?? undefined, withVectors,
  });
  return {
    entries: docs.map((d) => ({ $id: d.$id, metadata: d.metadata, ...(withVectors ? { vector: d.embeddings } : {}) })),
    next: docs.length === limit ? docs[docs.length - 1].$id : null,
  };
});
