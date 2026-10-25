import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { appOrigin } from "@/lib/server/consent";
import { requireUser, sessionSecret } from "@/lib/server/session";
import { Credential } from "../schema";

export const runtime = "nodejs";
const Body = z.object({ passkeyId: z.string().min(1).max(64), credential: Credential });

/** Step 2 of adding a passkey: the authenticator's response, verified and saved. */
export const POST = route(async (req) => {
  await requireUser();
  const { passkeyId, credential } = Body.parse(await readJson(req));
  return { passkey: await getBackend().auth.finishPasskeyRegistration((await sessionSecret())!, passkeyId, credential, appOrigin(req)) };
});
