import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { appOrigin } from "@/lib/server/consent";
import { HOUR, rateLimit } from "@/lib/server/rate-limit";
import { requireUser, sessionSecret } from "@/lib/server/session";
import { PasskeyName } from "./schema";

export const runtime = "nodejs";

export const GET = route(async () => {
  await requireUser();
  return { passkeys: await getBackend().auth.listPasskeys((await sessionSecret())!) };
});

/** Step 1 of adding a passkey: WebAuthn creation options for navigator.credentials.create(). */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { name } = z.object({ name: PasskeyName }).parse(await readJson(req));
  rateLimit("passkey-add", user.id, 10, HOUR, "Too many passkey requests.");
  const c = await getBackend().auth.startPasskeyRegistration((await sessionSecret())!, name, appOrigin(req));
  return { passkeyId: c.passkeyId, publicKey: c.publicKey, expire: c.expire };
});
