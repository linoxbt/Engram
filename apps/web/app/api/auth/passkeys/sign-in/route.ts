import { getBackend } from "@engram/server";
import { route } from "@/lib/server/api";
import { appOrigin, requireCookieConsent } from "@/lib/server/consent";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Step 1 of signing in with a passkey: request options for navigator.credentials.get(). No email needed. */
export const POST = route(async (req) => {
  requireCookieConsent(req);
  rateLimit("passkey-signin", clientIp(req), 30, 10 * MINUTE, "Too many sign-in attempts.");
  const c = await getBackend().auth.startPasskeySignIn(appOrigin(req));
  return { challengeId: c.id, publicKey: c.publicKey, expire: c.expire };
});
