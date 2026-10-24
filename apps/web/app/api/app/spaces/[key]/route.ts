import { deleteSpace, getConfig } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

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
export const DELETE = spaceRoute(async (ctx, access) => {
  requireOwner(access);
  await deleteSpace(ctx.b, ctx.space.key);
  return { ok: true };
});
