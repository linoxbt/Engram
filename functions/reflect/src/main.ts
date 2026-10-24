/**
 * reflect (stretch): daily schedule, or HTTP with {"space", "concept"}. Writes a
 * summary memory through the normal write path with refs.derivedFrom.
 */
import type { ConceptMeta } from "@engram/server";
import { backgroundDefer, getConfig, getSpace, listAllSpaces, reflect, ALL_SCOPES } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const data = body(ctx) as { space?: string; concept?: string };
  const spaces = data.space ? [await getSpace(b, data.space)].filter((s) => !!s) : (await listAllSpaces(b)).filter((s) => !s.settings.sandbox);
  const results = [];
  for (const space of spaces) {
    const c = { b, cfg: getConfig(), space: space!, actor: "system:reflect", actorName: "reflect", scopes: ALL_SCOPES, defer: backgroundDefer };
    const targets = data.concept ? [data.concept] : (await b.vectors.query<ConceptMeta>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [space!.key] }], limit: 200, withVectors: false }))
      .filter((x) => (x.metadata.membersN ?? 0) >= 10).map((x) => x.$id);
    for (const id of targets) {
      try { const r = await reflect(c, id); if (r.unchanged) continue; results.push({ space: space!.key, concept: id, seq: r.seq }); logJson(ctx, "reflect", results[results.length - 1]); }
      catch (e) { ctx.error(`reflect ${id}: ${e instanceof Error ? e.message : e}`); }
    }
  }
  return ctx.res.json({ ok: true, results });
};
