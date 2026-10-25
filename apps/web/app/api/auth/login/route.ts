import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { requireCookieConsent } from "@/lib/server/consent";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { replaceSession } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(256) });

export const POST = route(async (req) => {
  requireCookieConsent(req);
  const body = Body.parse(await readJson(req));
  const client = clientIp(req);
  rateLimit("login-ip", client, 30, 10 * MINUTE, "Too many sign-in attempts.");
  // Per account AND network, so nobody can lock a person out by guessing at their address; the shared per-account
  // cap lives in the backend (login-guard.ts).
  rateLimit("login-email", `${body.email}|${client}`, 10, 10 * MINUTE, "Too many sign-in attempts for this account.");
  const b = getBackend();
  const s = await b.auth.signIn(body.email, body.password, { client });
  await replaceSession(s.secret, s.expire);
  return { user: await b.auth.getUser(s.secret) };
});
