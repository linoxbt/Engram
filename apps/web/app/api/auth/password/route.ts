import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { requireUser, sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({ oldPassword: z.string().min(1).max(256), password: z.string().min(8).max(256) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = Body.parse(await readJson(req));
  rateLimit("password-user", user.id, 6, 15 * MINUTE, "Too many password changes.");
  await getBackend().auth.updatePassword((await sessionSecret())!, body.oldPassword, body.password);
  return { ok: true };
});
