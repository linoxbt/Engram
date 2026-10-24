import { iso } from "@engram/core";
import { loadChain } from "./chain";
import { loadCheckpoints } from "./checkpoints";
import type { Ctx } from "./context";
import { getConfig } from "./config";

/** Export a space as one JSON document and keep a copy in the exports bucket. */
export async function exportSpace(ctx: Ctx) {
  const [entries, checkpoints] = await Promise.all([loadChain(ctx.b, ctx.space.key), loadCheckpoints(ctx.b, ctx.space.key)]);
  const { people: _p, ...settings } = ctx.space.settings;
  const doc = {
    format: "engram-export-v1",
    exportedAt: iso(),
    space: ctx.space.key,
    settings,
    publicKey: getConfig().checkpoint.publicKey,
    entries: entries.map((e) => ({ id: e.$id, metadata: e.metadata })),
    checkpoints,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const fileId = `ex_${ctx.space.key}_${Date.now()}`;
  ctx.defer(() => ctx.b.files.put(getConfig().appwrite.exportsBucket, fileId, `${fileId}.json`, bytes, ctx.b.teamRead(ctx.space.teamId)).catch(() => undefined));
  return doc;
}
