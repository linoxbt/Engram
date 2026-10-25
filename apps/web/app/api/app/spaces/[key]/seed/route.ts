import { seedStory } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";

/** Continue writing a demo story started by space creation or a sandbox reset, one short slice per request. */
export const POST = spaceRoute(async (ctx, access) => {
  requireOwner(access);
  const p = ctx.space.settings.seeding;
  if (!p) return { done: true, progress: null };
  const r = await seedStory(ctx, { variant: p.variant, createdBy: p.createdBy, budgetMs: 6_000 });
  return { done: r.done, progress: r.progress, checkpoints: r.checkpoints };
});
