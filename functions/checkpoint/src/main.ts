/**
 * checkpoint: schedule every 5 minutes, and HTTP from the write path with {"space": "<key>"}.
 * Signs Merkle checkpoints with CP_PRIVATE_KEY, which lives only in this Function.
 * CHECKPOINT_BUDGET_MS (default 240000, at most 270000) keeps a run inside the 300 s timeout; least recently
 * checkpointed spaces go first and skipped ones are reported. Any failed space makes the execution fail (500), and
 * a refusal to sign (an integrity or key problem, already recorded and alerted) makes it 409.
 */
import { getConfig, getSpace, listAllSpaces, runScheduledCheckpoints, scheduleBudgetMs } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const key = getConfig().checkpoint.privateKey;
  if (!key) { ctx.error("CP_PRIVATE_KEY is not set"); return ctx.res.json({ ok: false, error: "missing signing key" }, 500); }
  const { space } = body(ctx) as { space?: string };
  const spaces = space ? [await getSpace(b, space)].filter((s) => !!s) : await listAllSpaces(b);
  const { results, skipped } = await runScheduledCheckpoints(b, spaces.map((s) => s!), { privateKey: key, budgetMs: scheduleBudgetMs(process.env.CHECKPOINT_BUDGET_MS) });
  for (const r of results) {
    if (r.status === "error" || r.status === "refused") ctx.error(`checkpoint ${r.status} for ${r.space}: ${r.reason}`);
    logJson(ctx, "checkpoint", r);
  }
  if (skipped.length) logJson(ctx, "checkpoint_skipped", { spaces: skipped });
  const errors = results.filter((r) => r.status === "error").length;
  const refused = results.filter((r) => r.status === "refused").length;
  return ctx.res.json({ ok: !errors && !refused, results, skipped, errors, refused }, errors ? 500 : refused ? 409 : 200);
};
