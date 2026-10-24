import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { requireCookieConsent } from "@/lib/server/consent";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { setSession } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(256) });

export const POST = route(async (req) => {
  requireCookieConsent(req);
  const body = Body.parse(await readJson(req));
  rateLimit("login-ip", clientIp(req), 30, 10 * MINUTE, "Too many sign-in attempts.");
  rateLimit("login-email", body.email, 10, 10 * MINUTE, "Too many sign-in attempts for this account.");
  const b = getBackend();
  const s = await b.auth.signIn(body.email, body.password);
  await setSession(s.secret, s.expire);
  return { user: await b.auth.getUser(s.secret) };
});
