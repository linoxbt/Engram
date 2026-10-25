import { iso } from "@engram/core";
import { loadChain } from "./chain";
import { loadCheckpoints } from "./checkpoints";
import type { Ctx } from "./context";
import { getConfig } from "./config";

/**
 * Export a space as one JSON document, streamed straight to the person who asked. Nothing is stored: a kept copy
 * would hold memory text and salts beyond the reach of forget and deletion.
 */
export async function exportSpace(ctx: Ctx, opts: { owner?: boolean } = {}) {
  const [entries, checkpoints] = await Promise.all([loadChain(ctx.b, ctx.space.key), loadCheckpoints(ctx.b, ctx.space.key)]);
  // Pending invites (token hashes) go only to the owner.
  const { people: _p, invites, ...rest } = ctx.space.settings;
  const settings = opts.owner ? { ...rest, invites } : rest;
  const doc = {
    format: "engram-export-v1",
    exportedAt: iso(),
    space: ctx.space.key,
    settings,
    publicKey: getConfig().checkpoint.publicKey,
    entries: entries.map((e) => ({ id: e.$id, metadata: e.metadata })),
    checkpoints,
  };
  return doc;
}
