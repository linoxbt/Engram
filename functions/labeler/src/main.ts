/**
 * labeler: names concepts.
 *  - Event trigger (concept document create/update, see appwrite.json): labels only when a member threshold is due
 *    (3, 10, 30, 100) and the app has not already labelled it inline, after a short grace period. A concept's create
 *    event is normally a no-op: it has one member and a rule-based label, and its first memory is tagged after it.
 *    The labeler's own label write fires another update event, which finds nothing due.
 *  - HTTP call with {"space": "<key>", "concept": "<id>"}: labels now, unconditionally.
 *
 * The event in appwrite.json names the database "engram": with another APPWRITE_DB_ID, edit that path too. Which
 * event namespace fires for VectorsDB documents is checked by the `events` provisioning step (docs/verified.md).
 */
import { backgroundDefer, getConfig, getSpace, isEngramError, labelConcept, ALL_SCOPES } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";
import { labelDue, type ConceptCounts } from "./due";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
/** Lets the app's inline relabel (deferred right after the member update) land first. */
const GRACE_MS = 4000;

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const data = body(ctx) as { space?: unknown; concept?: unknown; $id?: unknown; $databaseId?: unknown; $collectionId?: unknown; metadata?: ConceptCounts & { space?: unknown } };
  const trigger = ctx.req.headers["x-appwrite-trigger"] ?? "http";
  const event = ctx.req.headers["x-appwrite-event"] ?? null;
  const db = str(data.$databaseId), coll = str(data.$collectionId);
  if ((db && db !== getConfig().appwrite.databaseId) || (coll && coll !== "concepts")) {
    logJson(ctx, "label_skipped", { reason: "event from another database or collection", databaseId: db ?? null, collectionId: coll ?? null, event });
    return ctx.res.json({ ok: true, skipped: true });
  }
  const spaceKey = str(data.space) ?? str(data.metadata?.space);
  const conceptId = str(data.concept) ?? str(data.$id);
  if (!spaceKey || !conceptId) return ctx.res.json({ ok: false, error: "need space and concept" }, 400);

  // Everything that talks to Appwrite is inside the try: getSpace reads the state store, so a missing scope or a
  // network failure is a logged, failed execution rather than an unhandled throw with no trace of which concept it was.
  try {
    if (trigger === "event") {
      // Cheap check on the event payload first, then again on a fresh read after the grace period.
      if (labelDue(data.metadata) === null) {
        logJson(ctx, "label_skipped", { reason: "no member threshold due", space: spaceKey, concept: conceptId, event });
        return ctx.res.json({ ok: true, skipped: true });
      }
      await new Promise((r) => setTimeout(r, GRACE_MS));
      const fresh = await b.vectors.get<ConceptCounts & { space?: string }>("concepts", conceptId);
      if (!fresh || fresh.metadata.space !== spaceKey || labelDue(fresh.metadata) === null) {
        logJson(ctx, "label_skipped", { reason: fresh ? "labelled meanwhile" : "concept deleted", space: spaceKey, concept: conceptId, event });
        return ctx.res.json({ ok: true, skipped: true });
      }
    }

    const space = await getSpace(b, spaceKey);
    if (!space) return ctx.res.json({ ok: false, error: "space not found" }, 404);
    const out = await labelConcept({ b, cfg: getConfig(), space, actor: "system:labeler", actorName: "labeler", scopes: ALL_SCOPES, defer: backgroundDefer }, conceptId);
    logJson(ctx, "label", { space: spaceKey, concept: conceptId, label: out?.label ?? null, trigger, event });
    return ctx.res.json({ ok: true, label: out });
  } catch (e) {
    // Deleted since the event, or not in this space.
    if (isEngramError(e) && e.code === "not_found") return ctx.res.json({ ok: false, error: "concept not found" }, 404);
    ctx.error(`label ${conceptId} failed: ${e instanceof Error ? e.message : e}`);
    return ctx.res.json({ ok: false, error: "label failed" }, 500);
  }
};
