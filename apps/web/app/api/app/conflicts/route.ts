import type { EntryMeta } from "@engram/core";
import { getBackend, listSpacesForUser, type Backend } from "@engram/server";
import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";

const CONCURRENCY = 4;

/** Open conflict pairs in one space, counted the way /api/app/spaces/[key]/conflicts lists them. */
async function openPairs(b: Backend, key: string): Promise<number> {
  const docs = await b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [key] }, { op: "eq", path: "metadata.status", values: ["active"] }, { op: "eq", path: "metadata.conflict", values: ["true"] }],
    order: { field: "$id", dir: "desc" }, limit: 200, withVectors: false,
  });
  const ids = new Set(docs.map((d) => d.$id));
  const pairs = new Set<string>();
  for (const d of docs) for (const p of d.metadata.d.contradictedBy) if (ids.has(p)) pairs.add([d.$id, p].sort().join("|"));
  return pairs.size;
}

/** Inbox badge for the workspace shell: one request instead of one per space. A space that fails reads null. */
export const GET = route(async () => {
  const user = await requireUser();
  const b = getBackend();
  const keys = (await listSpacesForUser(b, user.id)).map((s) => s.key);
  const conflicts: Record<string, number | null> = {};
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      conflicts[key] = await openPairs(b, key).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
  return { conflicts };
});
