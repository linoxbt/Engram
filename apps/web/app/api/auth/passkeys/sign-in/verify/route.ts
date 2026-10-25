import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { appOrigin, requireCookieConsent } from "@/lib/server/consent";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { replaceSession } from "@/lib/server/session";
import { Credential } from "../../schema";

export const runtime = "nodejs";
const Body = z.object({ challengeId: z.string().min(1).max(64), credential: Credential });

/** Step 2 of signing in with a passkey: verify the assertion and start a session. */
export const POST = route(async (req) => {
  requireCookieConsent(req);
  rateLimit("passkey-verify", clientIp(req), 30, 10 * MINUTE, "Too many sign-in attempts.");
  const { challengeId, credential } = Body.parse(await readJson(req));
  const b = getBackend();
  const s = await b.auth.finishPasskeySignIn(challengeId, credential, appOrigin(req));
  await replaceSession(s.secret, s.expire);
  return { user: await b.auth.getUser(s.secret) };
});
