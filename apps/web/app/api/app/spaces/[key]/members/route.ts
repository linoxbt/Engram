import { z } from "zod";
import { createInvite, listInvites, listMembers } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";
import { appOrigin } from "@/lib/server/consent";
import { HOUR, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Members are visible to everyone in the space; pending invites only to the owner. */
export const GET = spaceRoute(async (ctx, access) => ({
  members: await listMembers(ctx.b, ctx.space.key),
  invites: access.owner ? await listInvites(ctx.b, ctx.space.key) : [],
}));

const Body = z.object({ email: z.string().trim().email().max(254).nullable().optional() });

export const POST = spaceRoute(async (ctx, access, req) => {
  requireOwner(access);
  const { email } = Body.parse(await readJson(req));
  rateLimit("invite", access.user.id, 30, HOUR, "Too many invites.");
  const { invite, token } = await createInvite(ctx.b, ctx.space.key, { email: email ?? null, createdBy: access.user.id });
  return { invite, url: `${appOrigin(req)}/invite?token=${encodeURIComponent(token)}` };
});
