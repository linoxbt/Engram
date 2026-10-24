import { getBackend } from "@engram/server";
import { route } from "@/lib/server/api";
import { appOrigin } from "@/lib/server/consent";
import { HOUR, rateLimit } from "@/lib/server/rate-limit";
import { requireUser, sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";

/** Resend the verification email to the signed-in user. */
export const POST = route(async (req) => {
  const user = await requireUser();
  if (user.emailVerified) return { ok: true, alreadyVerified: true };
  rateLimit("verify-user", user.id, 3, HOUR, "A verification email was sent recently.");
  const r = await getBackend().auth.requestVerification((await sessionSecret())!, `${appOrigin(req)}/verify-email`);
  return { ok: true, devLink: r.devLink };
});
