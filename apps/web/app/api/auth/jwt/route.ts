import { getBackend } from "@engram/server";
import { route } from "@/lib/server/api";
import { requireUser, sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";

/** Short-lived JWT so the browser SDK can subscribe to Realtime with the user's own permissions. */
export const GET = route(async () => {
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
