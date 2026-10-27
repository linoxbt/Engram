import { z } from "zod";
import { assertSpaceQuota, createSpace, getBackend, getSpace, listSpacesForUser, personCtx, seedStory } from "@engram/server";
import { defer, readJson, route } from "@/lib/server/api";
import { cleanDisplayName } from "@/lib/server/names";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
/** Hosts cut requests off after ~10 s; seeding writes for this long per request. */
const SEED_SLICE_MS = 6_000;

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

/**
 * A space name reaches an email subject line, the unauthenticated invite preview and the logs, so it goes
 * through the same scrubber as a person's display name: `trim()` alone leaves interior newlines, which is a
 * header injection waiting to happen ("Ops\nBcc: ...").
 */
const plainLine = (max: number) => z.string().max(max * 4).transform((s) => cleanDisplayName(s, max));

const Body = z.object({
  name: plainLine(64).refine((s) => s.length >= 2, "A name needs at least 2 characters."),
  description: z.string().default("").pipe(plainLine(300)),
  publicVerify: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  seed: z.enum(["none", "demo"]).default("none"),
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = Body.parse(await readJson(req));
  const b = getBackend();
  await assertSpaceQuota(b, user.id, body.sandbox);
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
