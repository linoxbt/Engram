/**
 * reflect (stretch): daily schedule, or HTTP with {"space", "concept"}. Writes a
 * summary memory through the normal write path with refs.derivedFrom.
 * REFLECT_BUDGET_MS (default 240000, at most 270000) keeps a run inside the 300 s timeout; least recently reflected
 * spaces go first and skipped ones are reported. Any failed space or concept makes the execution fail (500).
 */
import { getSpace, listAllSpaces, runScheduledReflect, scheduleBudgetMs, type SpaceInfo } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const data = body(ctx) as { space?: string; concept?: string };
  // Listing spaces reads team preferences and the state store; a missing scope here would otherwise throw out of
  // the handler with no log line at all. listAllSpaces skips a space it cannot read, so `spaces` is also logged:
  // a run that reflected nothing because every space was unreadable must not look like a quiet success.
  let spaces: SpaceInfo[];
  try {
    spaces = data.space ? [await getSpace(b, data.space)].filter((s) => !!s) : (await listAllSpaces(b)).filter((s) => !s.settings.sandbox);
  } catch (e) {
    ctx.error(`reflect could not read spaces: ${e instanceof Error ? e.message : e}`);
    return ctx.res.json({ ok: false, error: "could not read spaces" }, 500);
  }
  if (!spaces.length) {
    logJson(ctx, "reflect_no_spaces", { requested: data.space ?? null });
    return ctx.res.json({ ok: !data.space, results: [], errors: [], skipped: [], spaces: 0 }, data.space ? 404 : 200);
  }
  const { results, errors, skipped } = await runScheduledReflect(b, spaces, { budgetMs: scheduleBudgetMs(process.env.REFLECT_BUDGET_MS), concept: data.concept });
  for (const r of results) logJson(ctx, "reflect", r);
  for (const e of errors) ctx.error(`reflect ${e.space}${e.concept ? `/${e.concept}` : ""}: ${e.message}`);
  if (skipped.length) logJson(ctx, "reflect_skipped", { spaces: skipped });
  return ctx.res.json({ ok: !errors.length, results, errors, skipped, spaces: spaces.length }, errors.length ? 500 : 200);
};
