/**
 * reflect (stretch): daily schedule, or HTTP with {"space", "concept"}. Writes a
 * summary memory through the normal write path with refs.derivedFrom.
 * REFLECT_BUDGET_MS (default 240000, at most 270000) keeps a run inside the 300 s timeout; least recently reflected
 * spaces go first and skipped ones are reported. Any failed space or concept makes the execution fail (500).
 */
import { getSpace, listAllSpaces, runScheduledReflect, scheduleBudgetMs } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const data = body(ctx) as { space?: string; concept?: string };
  const spaces = data.space ? [await getSpace(b, data.space)].filter((s) => !!s) : (await listAllSpaces(b)).filter((s) => !s.settings.sandbox);
  const { results, errors, skipped } = await runScheduledReflect(b, spaces.map((s) => s!), { budgetMs: scheduleBudgetMs(process.env.REFLECT_BUDGET_MS), concept: data.concept });
  for (const r of results) logJson(ctx, "reflect", r);
  for (const e of errors) ctx.error(`reflect ${e.space}${e.concept ? `/${e.concept}` : ""}: ${e.message}`);
  if (skipped.length) logJson(ctx, "reflect_skipped", { spaces: skipped });
  return ctx.res.json({ ok: !errors.length, results, errors, skipped }, errors.length ? 500 : 200);
};
