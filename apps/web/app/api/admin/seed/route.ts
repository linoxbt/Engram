import { z } from "zod";
import { timingSafeEqualHex } from "@engram/core";
import { createSpace, getBackend, getConfig, getSpace, personCtx, seedStory, EngramError, updateSettings } from "@engram/server";
import { defer, readJson, route } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  ownerEmail: z.string().email(),
  variant: z.enum(["demo", "sandbox"]).default("demo"),
  name: z.string().default("Northwind support"),
  key: z.string().regex(/^[a-z0-9]{8}$/).optional(),
  publicVerify: z.boolean().default(true),
});

/** Seeds the demo story with past timestamps. Protected by SEED_ADMIN_TOKEN; delete the token after seeding. */
export const POST = route(async (req) => {
  const token = getConfig().seedAdminToken;
  if (!token || !timingSafeEqualHex(req.headers.get("authorization") ?? "", `Bearer ${token}`)) throw new EngramError("unauthorized", "Seed route disabled or bad token.");
  const body = Body.parse(await readJson(req));
  const b = getBackend();
  const password = req.headers.get("x-owner-password");
  if (!password) throw new EngramError("bad_request", "Send the owner's password in X-Owner-Password so the seed can sign in as them.");
  const session = await b.auth.signIn(body.ownerEmail, password);
  const user = (await b.auth.getUser(session.secret))!;
  const existing = body.key ? await getSpace(b, body.key) : null;
  const space = existing ?? (await createSpace(b, { name: body.name, ownerId: user.id, ownerName: user.name, publicVerify: body.publicVerify, sandbox: body.variant === "sandbox", key: body.key }));
  if (body.publicVerify && !space.settings.publicVerify) await updateSettings(b, space.key, { publicVerify: true });
  const res = await seedStory(personCtx(b, (await getSpace(b, space.key))!, user, defer), { variant: body.variant, createdBy: `user:${user.id}` });
  await b.auth.signOut(session.secret);
  return { space: space.key, ...res };
});
