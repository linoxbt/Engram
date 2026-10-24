import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { appOrigin } from "@/lib/server/consent";
import { clientIp, HOUR, MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const Body = z.object({ email: z.string().email() });

/** Always answers the same way, so it cannot be used to learn which addresses have accounts. */
export const POST = route(async (req) => {
  const body = Body.parse(await readJson(req));
  rateLimit("recovery-ip", clientIp(req), 6, 15 * MINUTE, "Too many reset requests.");
  rateLimit("recovery-email", body.email, 3, HOUR, "Too many reset emails for this address.");
  const r = await getBackend().auth.requestRecovery(body.email, `${appOrigin(req)}/reset-password`);
  return { ok: true, devLink: r.devLink };
});
