import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const Body = z.object({ userId: z.string().min(1).max(64), secret: z.string().min(1).max(512), password: z.string().min(8).max(256) });

export const POST = route(async (req) => {
  const body = Body.parse(await readJson(req));
  rateLimit("recovery-complete-ip", clientIp(req), 10, 15 * MINUTE);
  await getBackend().auth.completeRecovery(body.userId, body.secret, body.password);
  return { ok: true };
});
