import { z } from "zod";
import { getBackend } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { requireUser, sessionSecret } from "@/lib/server/session";
import { PasskeyName } from "../schema";

export const runtime = "nodejs";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  await requireUser();
  const { name } = z.object({ name: PasskeyName }).parse(await readJson(req));
  return { passkey: await getBackend().auth.renamePasskey((await sessionSecret())!, id, name) };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  await requireUser();
  await getBackend().auth.deletePasskey((await sessionSecret())!, id);
  return { ok: true };
});
