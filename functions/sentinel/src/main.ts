/**
 * sentinel: schedule every 15 minutes. Re-verifies spaces (least recently checked first), records integrity,
 * alerts, applies retention. SENTINEL_BUDGET_MS (default 240000) keeps a run inside the 300 s timeout.
 */
import { runSentinel } from "@engram/server";
import { boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const budgetMs = Number(process.env.SENTINEL_BUDGET_MS) || undefined;
  const { results, skipped } = await runSentinel(b, { budgetMs });
  for (const r of results) logJson(ctx, "sentinel", r);
  if (skipped.length) logJson(ctx, "sentinel_skipped", { spaces: skipped });
  return ctx.res.json({ ok: true, results, skipped });
};
