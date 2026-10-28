import { type EntryMeta } from "@engram/core";
import { parseEntryCursor, parseLimit } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { publicChainEntries } from "@/lib/server/shapes";

export const runtime = "nodejs";

/** Full entries for the in-browser verifier (members may see text and salts). `vectors=1` for deep mode. */
export const GET = spaceRoute(async (ctx, access, req) => {
  const sp = req.nextUrl.searchParams;
  const limit = parseLimit(sp.get("limit"), 500, 500);
  const cursor = await parseEntryCursor(ctx.b, ctx.space.key, sp.get("cursor"));
  // A viewer gets headers and hashes only, so deep mode has nothing to read: fetching vectors for one would
  // cost the query its cheapest path and hand back nothing.
  const withVectors = sp.get("vectors") === "1" && !access.viewer;
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }],
    order: { field: "$id", dir: "asc" }, limit, cursorAfter: cursor, withVectors,
  });
  return {
    entries: publicChainEntries(
      docs.map((d) => ({ $id: d.$id, metadata: d.metadata, ...(withVectors ? { vector: d.embeddings } : {}) })),
      access.viewer,
    ),
    next: docs.length === limit ? docs[docs.length - 1].$id : null,
  };
});
