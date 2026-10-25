import { z } from "zod";
import { deleteSpace, getConfig, EngramError } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";
import { MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx, access) => {
  const { people: _p, ...settings } = ctx.space.settings;
  const cfg = getConfig();
  return {
    key: ctx.space.key, settings, role: access.owner ? "owner" : "member",
    user: { id: access.user.id, name: access.user.name, email: access.user.email },
    publicKey: cfg.checkpoint.publicKey, keyId: cfg.checkpoint.keyId,
    signing: { inline: !!cfg.checkpoint.privateKey, function: !!cfg.appwrite.checkpointFunctionId },
    backend: ctx.b.kind, appUrl: cfg.appUrl,
  };
});
const Delete = z.object({ password: z.string().min(1).max(256) });
export const DELETE = spaceRoute(async (ctx, access, req) => {
  requireOwner(access);
  const body = Delete.parse(await readJson(req));
  rateLimit("delete-space", access.user.id, 5, 15 * MINUTE);
  // Re-authenticate: a stolen session alone must not be enough to destroy a space.
  const check = await ctx.b.auth.signIn(access.user.email, body.password).catch(() => null);
  if (!check) throw new EngramError("unauthorized", "Your password is incorrect.");
  await ctx.b.auth.signOut(check.secret);
  await deleteSpace(ctx.b, ctx.space.key);
  return { ok: true };
});
