import { type EntryMeta } from "@engram/core";
import { parseEntryCursor, parseLimit } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";

/** Full entries for the in-browser verifier (members may see text). `vectors=1` for deep mode. */
export const GET = spaceRoute(async (ctx, _a, req) => {
  const sp = req.nextUrl.searchParams;
  const limit = parseLimit(sp.get("limit"), 500, 500);
  const cursor = await parseEntryCursor(ctx.b, ctx.space.key, sp.get("cursor"));
  const withVectors = sp.get("vectors") === "1";
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }],
    order: { field: "$id", dir: "asc" }, limit, cursorAfter: cursor, withVectors,
  });
  return {
    entries: docs.map((d) => ({ $id: d.$id, metadata: d.metadata, ...(withVectors ? { vector: d.embeddings } : {}) })),
    next: docs.length === limit ? docs[docs.length - 1].$id : null,
  };
});
