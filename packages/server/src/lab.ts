/** Tamper Lab: deliberately corrupt a sandbox space with the server key and let the verifier catch it. */
import { runAttack, ATTACKS, type AttackId, type AttackParams } from "@engram/core";
import { loadChain } from "./chain";
import { runCheckpoint } from "./checkpoints";
import type { Ctx } from "./context";
import { EngramError } from "./errors";
import { seedStory } from "./seed";
import { getSpace, purgeSpaceData } from "./spaces";

export function requireSandbox(ctx: Ctx) {
  if (!ctx.space.settings.sandbox) throw new EngramError("not_sandbox", "Tamper Lab actions only run in sandbox spaces.");
}

export async function attack(ctx: Ctx, id: AttackId, params: AttackParams = {}) {
  requireSandbox(ctx);
  const info = ATTACKS.find((a) => a.id === id);
  if (!info) throw new EngramError("bad_request", `Unknown attack ${id}.`);
  const entries = await loadChain(ctx.b, ctx.space.key, { withVectors: true });
  if (!entries.length) throw new EngramError("bad_request", "The sandbox is empty. Reset it first.");
  const res = await runAttack(id, entries, params);
  const byId = new Map(res.entries.map((e) => [e.$id, e]));
  for (const changed of res.changed) {
    const e = byId.get(changed)!;
    await ctx.b.vectors.update("memories", changed, { metadata: e.metadata, ...(e.vector ? { embeddings: e.vector } : {}) });
  }
  for (const gone of res.deleted) await ctx.b.vectors.delete("memories", gone);
  return { attack: info, summary: res.summary, target: res.target, changed: res.changed, deleted: res.deleted };
}

/** Purge and start re-seeding. With a budget, `done: false` means: call seedStory again to continue. */
export async function resetSandbox(ctx: Ctx, createdBy: string, budgetMs?: number) {
  requireSandbox(ctx);
  await purgeSpaceData(ctx.b, ctx.space.key);
  const fresh = (await getSpace(ctx.b, ctx.space.key)) ?? ctx.space;
  await ctx.b.teams.updatePrefs(fresh.teamId, { ...fresh.settings, latestCheckpoint: null, integrity: null, seeding: null });
  const space = (await getSpace(ctx.b, ctx.space.key)) ?? fresh;
  const seeded = await seedStory({ ...ctx, space }, { variant: "sandbox", createdBy, budgetMs });
  if (!ctx.cfg.checkpoint.privateKey) {
    const queued = await ctx.b.jobs.triggerCheckpoint(ctx.space.key);
    return { ...seeded, note: queued ? "Checkpoint queued in the checkpoint Function." : "No signing key available: attacks 4 and 5 need a signed checkpoint." };
  }
  return { ...seeded, note: null };
}

export async function sealSandbox(ctx: Ctx) {
  requireSandbox(ctx);
  if (!ctx.cfg.checkpoint.privateKey) throw new EngramError("unavailable", "No checkpoint signing key in this process.");
  return runCheckpoint(ctx.b, ctx.space, { privateKey: ctx.cfg.checkpoint.privateKey });
}
