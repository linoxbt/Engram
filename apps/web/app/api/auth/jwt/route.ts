import { getBackend } from "@engram/server";
import { route } from "@/lib/server/api";
import { requireCookieConsent } from "@/lib/server/consent";
import { requireUser, sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * A 15-minute JWT, bound to this browser's session, so the browser SDK can open a Realtime socket with the user's
 * own permissions. Only for signed-in people who accepted cookies (and the Terms); everyone else polls.
 */
export const GET = route(async (req) => {
  requireCookieConsent(req);
  await requireUser();
  const secret = await sessionSecret();
  const jwt = secret ? await getBackend().auth.createJwt(secret) : null;
  return {
    jwt,
    endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? null,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? null,
    databaseId: process.env.NEXT_PUBLIC_DB_ID ?? process.env.APPWRITE_DB_ID ?? "engram",
  };
});
