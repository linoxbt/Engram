import { type EntryMeta } from "@engram/core";
import { parseEntryCursor, parseLimit, remember, type Filter } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";
import { limitSpaceWork } from "@/lib/server/rate-limit";
import { toFeedItem, agentNames } from "@engram/server";

export const runtime = "nodejs";

/** Browse entries newest first with filters (the explorer's list mode). */
export const GET = spaceRoute(async (ctx, _a, req) => {
  const sp = req.nextUrl.searchParams;
  const filters: Filter[] = [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }];
  const status = sp.get("status"); if (status) filters.push({ op: "eq", path: "metadata.status", values: status.split(",") });
  const kind = sp.get("kind"); if (kind) filters.push({ op: "eq", path: "metadata.kind", values: kind.split(",") });
  const subject = sp.get("subject"); if (subject) filters.push({ op: "eq", path: "metadata.subject", values: [subject] });
  const agent = sp.get("agent"); if (agent) filters.push({ op: "eq", path: "metadata.agent", values: [agent] });
  const op = sp.get("op"); if (op) filters.push({ op: "eq", path: "metadata.op", values: op.split(",") });
  const limit = parseLimit(sp.get("limit"), 50, 200);
  const cursor = await parseEntryCursor(ctx.b, ctx.space.key, sp.get("cursor"));
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", { filters, order: { field: "$id", dir: "desc" }, limit, cursorAfter: cursor, withVectors: false });
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  return { items: docs.map((d) => toFeedItem(d, names)), next: docs.length ? docs[docs.length - 1].$id : null };
});

/** An embedding and a classifier call each: capped per person and space, the engine only caps agent keys. */
export const POST = spaceRoute(async (ctx, access, req) => {
  limitSpaceWork("remember", access.user.id, ctx.space.key);
  return remember(ctx, await readJson(req));
});
