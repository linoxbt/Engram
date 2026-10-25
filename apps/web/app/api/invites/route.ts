import { z } from "zod";
import { acceptInvite, getBackend, previewInvite } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
const Token = z.string().trim().min(10).max(200);

/** Preview: which space an invite link is for, before signing in. */
export const GET = route(async (req) => {
  rateLimit("invite-preview", clientIp(req), 60, 10 * MINUTE, "Too many requests.");
  return previewInvite(getBackend(), Token.parse(new URL(req.url).searchParams.get("token") ?? ""));
});

export const POST = route(async (req) => {
  const user = await requireUser();
  rateLimit("invite-accept", user.id, 20, 10 * MINUTE, "Too many attempts.");
  const { token } = z.object({ token: Token }).parse(await readJson(req));
  return acceptInvite(getBackend(), token, user);
});
