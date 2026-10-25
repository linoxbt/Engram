import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { requireCookieConsent } from "@/lib/server/consent";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({ accept: z.literal(true, { message: "Agree to the Terms of Service and Privacy Policy to continue." }) });

/**
 * Accept the Terms for an account that never did through Engram (one created directly against Appwrite). The one
 * signed-in call such an account may make besides deleting itself; until then every other call is terms_required.
 */
export const POST = route(async (req) => {
  requireCookieConsent(req);
  const user = await requireUser();
  Body.parse(await readJson(req));
  if (!user.termsAcceptedAt) await getBackend().auth.acceptTerms(user.id);
  return { ok: true };
});
