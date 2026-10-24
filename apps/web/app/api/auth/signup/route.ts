import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { appOrigin, requireCookieConsent } from "@/lib/server/consent";
import { clientIp, HOUR, rateLimit } from "@/lib/server/rate-limit";
import { setSession } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  name: z.string().trim().min(1).max(80),
  acceptTerms: z.literal(true, { message: "Agree to the Terms of Service and Privacy Policy to create an account." }),
});

export const POST = route(async (req) => {
  requireCookieConsent(req);
  const body = Body.parse(await readJson(req));
  rateLimit("signup-ip", clientIp(req), 8, HOUR, "Too many accounts created from this network.");
  const b = getBackend();
  const user = await b.auth.signUp(body.email, body.password, body.name);
  const s = await b.auth.signIn(body.email, body.password);
  await setSession(s.secret, s.expire);
  // Best effort: the account works without it, and the banner offers to resend.
  const verification = await b.auth.requestVerification(s.secret, `${appOrigin(req)}/verify-email`).catch((e) => {
    console.warn("[engram] verification email not sent", e instanceof Error ? e.message : e);
    return null;
  });
  return { user, verificationSent: !!verification, devLink: verification?.devLink };
});
