/**
 * labeler: names concepts. Trigger on a VectorsDB concept document event, or
 * call over HTTP with {"space": "<key>", "concept": "<id>"}. The app falls back
 * to labelling inline when Function events are unavailable.
 */
import { backgroundDefer, getConfig, getSpace, labelConcept, ALL_SCOPES } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const data = body(ctx) as { space?: string; concept?: string; $id?: string; metadata?: { space?: string } };
  const spaceKey = data.space ?? data.metadata?.space;
  const conceptId = data.concept ?? data.$id;
  if (!spaceKey || !conceptId) return ctx.res.json({ ok: false, error: "need space and concept" }, 400);
  const space = await getSpace(b, spaceKey);
  if (!space) return ctx.res.json({ ok: false, error: "space not found" }, 404);
  const out = await labelConcept({ b, cfg: getConfig(), space, actor: "system:labeler", actorName: "labeler", scopes: ALL_SCOPES, defer: backgroundDefer }, conceptId);
  logJson(ctx, "label", { space: spaceKey, concept: conceptId, label: out?.label ?? null });
  return ctx.res.json({ ok: true, label: out });
};
