import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({ userId: z.string().min(1).max(64), secret: z.string().min(1).max(512) });

export const POST = route(async (req) => {
  const body = Body.parse(await readJson(req));
  rateLimit("verify-complete-ip", clientIp(req), 20, 15 * MINUTE);
  await getBackend().auth.completeVerification(body.userId, body.secret, await sessionSecret());
  return { ok: true };
});
