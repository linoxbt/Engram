/** sentinel: schedule every 15 minutes. Re-verifies every space, records integrity, alerts, applies retention. */
import { runSentinel } from "@engram/server";
import { boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const results = await runSentinel(b);
  for (const r of results) logJson(ctx, "sentinel", r);
  return ctx.res.json({ ok: true, results });
};
