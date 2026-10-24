import { getBackend } from "@engram/server";
import { route } from "@/lib/server/api";
import { clearSession, sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";
export const POST = route(async () => {
  const s = await sessionSecret();
  if (s) await getBackend().auth.signOut(s).catch(() => undefined);
  await clearSession();
  return { ok: true };
});
