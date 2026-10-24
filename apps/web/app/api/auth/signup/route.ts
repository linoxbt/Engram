import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { setSession } from "@/lib/server/session";

export const runtime = "nodejs";
const Body = z.object({ email: z.string().email(), password: z.string().min(8).max(256), name: z.string().trim().min(1).max(80) });

export const POST = route(async (req) => {
  const body = Body.parse(await readJson(req));
  const b = getBackend();
  const user = await b.auth.signUp(body.email, body.password, body.name);
  const s = await b.auth.signIn(body.email, body.password);
  await setSession(s.secret, s.expire);
  return { user };
});
