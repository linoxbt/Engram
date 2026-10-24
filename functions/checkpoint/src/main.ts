/**
 * checkpoint: schedule every 5 minutes, and HTTP from the write path with {"space": "<key>"}.
 * Signs Merkle checkpoints with CP_PRIVATE_KEY, which lives only in this Function.
 */
import { getConfig, getSpace, listAllSpaces, runCheckpoint } from "@engram/server";
import { body, boot, logJson, type FnContext } from "../../shared";

export default async (ctx: FnContext) => {
  const b = boot(ctx);
  const key = getConfig().checkpoint.privateKey;
  if (!key) { ctx.error("CP_PRIVATE_KEY is not set"); return ctx.res.json({ ok: false, error: "missing signing key" }, 500); }
  const { space } = body(ctx) as { space?: string };
  const spaces = space ? [await getSpace(b, space)].filter((s) => !!s) : await listAllSpaces(b);
  const results = [];
  for (const s of spaces) {
    try {
      const r = await runCheckpoint(b, s!, { privateKey: key });
      results.push({ space: s!.key, created: r.created, seq: r.checkpoint?.seq ?? null, reason: r.reason ?? null });
      logJson(ctx, "checkpoint", results[results.length - 1]);
    } catch (e) {
      ctx.error(`checkpoint failed for ${s!.key}: ${e instanceof Error ? e.message : e}`);
      results.push({ space: s!.key, created: false, reason: "error" });
    }
  }
  return ctx.res.json({ ok: true, results });
};
