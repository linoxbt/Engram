import { z } from "zod";
import { bearerMatches, createSpace, getBackend, getConfig, getSpace, isConflict, personCtx, seedStory, EngramError, updateSettings } from "@engram/server";
import { defer, readJson, route } from "@/lib/server/api";

export const runtime = "nodejs";

const Body = z.object({
  ownerEmail: z.string().email(),
  variant: z.enum(["demo", "sandbox"]).default("demo"),
  name: z.string().default("Northwind support"),
  key: z.string().regex(/^[a-z0-9]{8}$/).optional(),
  publicVerify: z.boolean().default(true),
});

/**
 * Seeds the demo story with past timestamps. Does not exist unless SEED_ADMIN_TOKEN is set; delete the token after
 * seeding. An explicit key must be new, except to resume a seed of that key the same owner started.
 */
export const POST = route(async (req) => {
  const token = getConfig().seedAdminToken;
  if (!token) throw new EngramError("not_found", "Not found.");
  if (!(await bearerMatches(req.headers.get("authorization"), token))) throw new EngramError("unauthorized", "Bad seed token.");
  const body = Body.parse(await readJson(req));
  const b = getBackend();
  const password = req.headers.get("x-owner-password");
  if (!password) throw new EngramError("bad_request", "Send the owner's password in X-Owner-Password so the seed can sign in as them.");
  const session = await b.auth.signIn(body.ownerEmail, password);
  try {
    const user = (await b.auth.getUser(session.secret))!;
    const existing = body.key ? await getSpace(b, body.key) : null;
    if (existing && !(existing.settings.seeding && existing.settings.ownerId === user.id)) throw new EngramError("conflict", `Space ${body.key} already exists.`);
    let space = existing;
    if (!space) {
      try {
        space = await createSpace(b, { name: body.name, ownerId: user.id, ownerName: user.name, publicVerify: body.publicVerify, sandbox: body.variant === "sandbox", key: body.key });
      } catch (e) {
        // The team exists without readable settings (half-deleted or foreign): still not ours to write into.
        if (isConflict(e)) throw new EngramError("conflict", `Space ${body.key} already exists.`);
        throw e;
      }
    }
    if (body.publicVerify && !space.settings.publicVerify) await updateSettings(b, space.key, { publicVerify: true });
    const res = await seedStory(personCtx(b, (await getSpace(b, space.key))!, user, defer), { variant: body.variant, createdBy: `user:${user.id}` });
    return { space: space.key, ...res };
  } finally {
    await b.auth.signOut(session.secret).catch(() => undefined);
  }
});
