import { z } from "zod";
import { createSpace, getBackend, getSpace, listSpacesForUser, personCtx, seedStory } from "@engram/server";
import { defer, readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
/** Hosts cut requests off after ~10 s; seeding writes for this long per request. */
const SEED_SLICE_MS = 6_000;
export const maxDuration = 120;

export const GET = route(async () => {
  const user = await requireUser();
  const spaces = await listSpacesForUser(getBackend(), user.id);
  return {
    spaces: spaces.map((s) => ({
      key: s.key, name: s.settings.name, description: s.settings.description, sandbox: s.settings.sandbox, publicVerify: s.settings.publicVerify,
      integrity: s.settings.integrity, latestCheckpoint: s.settings.latestCheckpoint, createdAt: s.settings.createdAt, owner: s.settings.ownerId === user.id,
    })),
  };
});

const Body = z.object({
  name: z.string().trim().min(2).max(64),
  description: z.string().trim().max(300).default(""),
  publicVerify: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  seed: z.enum(["none", "demo"]).default("none"),
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = Body.parse(await readJson(req));
  const b = getBackend();
  const space = await createSpace(b, { name: body.name, description: body.description, ownerId: user.id, ownerName: user.name, publicVerify: body.publicVerify, sandbox: body.sandbox });
  let keys: Record<string, string> = {};
  let seeding: { done: boolean; progress: { done: number; total: number } } | null = null;
  if (body.sandbox || body.seed === "demo") {
    // The first slice only: the page continues through /seed until the story is written.
    const res = await seedStory(personCtx(b, space, user, defer), { variant: body.sandbox ? "sandbox" : "demo", createdBy: `user:${user.id}`, budgetMs: SEED_SLICE_MS });
    keys = res.keys;
    seeding = { done: res.done, progress: res.progress };
  }
  const fresh = (await getSpace(b, space.key)) ?? space;
  return { key: fresh.key, name: fresh.settings.name, agentKeys: keys, seeding };
});
