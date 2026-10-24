import { z } from "zod";
import { deleteSpace, EngramError, getBackend, isEngramError, isOwnerRole, listSpacesForUser, membership } from "@engram/server";
import { readJson, route } from "@/lib/server/api";
import { MINUTE, rateLimit } from "@/lib/server/rate-limit";
import { clearSession, currentUser, requireUser, sessionSecret } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route(async () => ({ user: await currentUser() }));

const Patch = z.object({ name: z.string().trim().min(1).max(80) });
export const PATCH = route(async (req) => {
  await requireUser();
  const body = Patch.parse(await readJson(req));
  return { user: await getBackend().auth.updateName((await sessionSecret())!, body.name) };
});

const Delete = z.object({ password: z.string().min(1).max(256), confirm: z.literal("DELETE", { message: 'Type DELETE to confirm.' }) });
/** Deletes the account and every space it owns. Memberships in other people's spaces simply end. */
export const DELETE = route(async (req) => {
  const user = await requireUser();
  const body = Delete.parse(await readJson(req));
  rateLimit("delete-user", user.id, 5, 15 * MINUTE);
  const b = getBackend();
  // Re-authenticate: a stolen session alone must not be enough to destroy an account.
  const check = await b.auth.signIn(user.email, body.password).catch(() => null);
  if (!check) throw new EngramError("unauthorized", "Your password is incorrect.");
  await b.auth.signOut(check.secret);
  for (const space of await listSpacesForUser(b, user.id)) {
    const m = await membership(b, space.key, user.id);
    if (!m || !isOwnerRole(m.roles)) continue;
    try {
      await deleteSpace(b, space.key);
    } catch (e) {
      // With no memory database there is no space data to purge; the team still goes.
      if (isEngramError(e) && e.code === "unavailable") await b.teams.delete(space.teamId);
      else throw e;
    }
  }
  await b.auth.deleteUser(user.id);
  await clearSession();
  return { ok: true };
});
