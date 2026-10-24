import { type EntryMeta } from "@engram/core";
import { getBackend } from "@engram/server";
import { route } from "@/lib/server/api";
import { publicSpace } from "@/lib/server/public";

export const runtime = "nodejs";

/** Header fields and hashes only, paged in chain order. */
export const GET = route<{ key: string }>(async (req, { key }) => {
  await publicSpace(key);
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 500)));
  const docs = await getBackend().vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [key] }],
    order: { field: "$id", dir: "asc" }, limit, cursorAfter: cursor, withVectors: false,
  });
  return {
    entries: docs.map((d) => ({ $id: d.$id, h: d.metadata.h, hash: d.metadata.hash })),
    next: docs.length === limit ? docs[docs.length - 1].$id : null,
  };
});
