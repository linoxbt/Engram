/**
 * sentinel: schedule every 15 minutes. Re-verifies spaces (least recently checked first), records integrity,
 * alerts once per incident, applies pending work and retention. SENTINEL_BUDGET_MS (default 240000, capped at
 * 270000) keeps a run inside the 300 s timeout. Any failed space makes the execution fail (500).
 */
import { runSentinel, scheduleBudgetMs } from "@engram/server";
import { boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const { results, skipped } = await runSentinel(b, { budgetMs: scheduleBudgetMs(process.env.SENTINEL_BUDGET_MS) });
  for (const r of results) logJson(ctx, "sentinel", r);
  if (skipped.length) logJson(ctx, "sentinel_skipped", { spaces: skipped });
  const errors = results.filter((r) => r.status === "error").length;
  if (errors) ctx.error(`sentinel failed for ${errors} space(s)`);
  return ctx.res.json({ ok: !errors, results, skipped, errors }, errors ? 500 : 200);
};
