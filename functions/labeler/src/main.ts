/**
 * labeler: names concepts. Trigger on a VectorsDB concept document event, or
 * call over HTTP with {"space": "<key>", "concept": "<id>"}. The app falls back
 * to labelling inline when Function events are unavailable.
 *
 * The event in appwrite.json names the database "engram": with another APPWRITE_DB_ID, edit that path too.
 */
import { backgroundDefer, getConfig, getSpace, isEngramError, labelConcept, ALL_SCOPES } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const data = body(ctx) as { space?: unknown; concept?: unknown; $id?: unknown; $databaseId?: unknown; $collectionId?: unknown; metadata?: { space?: unknown } };
  const db = str(data.$databaseId), coll = str(data.$collectionId);
  if ((db && db !== getConfig().appwrite.databaseId) || (coll && coll !== "concepts")) {
    logJson(ctx, "label_skipped", { reason: "event from another database or collection", databaseId: db ?? null, collectionId: coll ?? null });
    return ctx.res.json({ ok: true, skipped: true });
  }
  const spaceKey = str(data.space) ?? str(data.metadata?.space);
  const conceptId = str(data.concept) ?? str(data.$id);
  if (!spaceKey || !conceptId) return ctx.res.json({ ok: false, error: "need space and concept" }, 400);
  const space = await getSpace(b, spaceKey);
  if (!space) return ctx.res.json({ ok: false, error: "space not found" }, 404);
  try {
    const out = await labelConcept({ b, cfg: getConfig(), space, actor: "system:labeler", actorName: "labeler", scopes: ALL_SCOPES, defer: backgroundDefer }, conceptId);
    logJson(ctx, "label", { space: spaceKey, concept: conceptId, label: out?.label ?? null });
    return ctx.res.json({ ok: true, label: out });
  } catch (e) {
    // Deleted since the event, or not in this space.
    if (isEngramError(e) && e.code === "not_found") return ctx.res.json({ ok: false, error: "concept not found" }, 404);
    ctx.error(`label ${conceptId} failed: ${e instanceof Error ? e.message : e}`);
    return ctx.res.json({ ok: false, error: "label failed" }, 500);
  }
};
