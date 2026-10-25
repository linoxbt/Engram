import { EngramError, getBackend, getSpace, GUEST_TTL_MS, membership } from "@engram/server";
import { defer, route } from "@/lib/server/api";
import { VIEWER_ROLE } from "@/lib/server/access";
import { requireCookieConsent } from "@/lib/server/consent";
import { clientIp, HOUR, rateLimit } from "@/lib/server/rate-limit";
import { currentUser, replaceSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** How many expired guests one visit removes, so the clean-up never makes a visit slow. */
const CLEANUP_BATCH = 10;

/**
 * The read-only live demo: a throwaway guest account (no email, no password anyone knows) that is a "viewer" of the
 * demo space, signed in with a session cookie. Viewers can read everything a member reads and write nothing.
 * Guests are deleted after 24 hours, a few at a time, by later visits.
 */
export const POST = route(async (req) => {
  requireCookieConsent(req);
  const key = process.env.DEMO_SPACE?.trim() || process.env.NEXT_PUBLIC_DEMO_SPACE?.trim();
  if (!key) throw new EngramError("not_found", "This deployment has no live demo.");
  const b = getBackend();
  const space = await getSpace(b, key);
  if (!space) throw new EngramError("not_found", "This deployment has no live demo.");

  defer(() => b.auth.deleteGuests(new Date(Date.now() - GUEST_TTL_MS).toISOString(), CLEANUP_BATCH));

  // Already in (a guest coming back, or a member of the demo space): nothing to create.
  const me = await currentUser();
  if (me && (await membership(b, key, me.id))) return { ok: true, space: key };

  rateLimit("demo-enter-ip", clientIp(req), 5, HOUR, "Too many demo visits from this network.");

  const { user, session } = await b.auth.createGuest();
  try {
    await b.teams.addMember(space.teamId, user.id, [VIEWER_ROLE]);
  } catch (e) {
    await b.auth.deleteUser(user.id).catch(() => undefined);
    throw e;
  }
  // The cookie lasts no longer than the guest does.
  const until = Math.min(Date.parse(session.expire) || Infinity, Date.now() + GUEST_TTL_MS);
  await replaceSession(session.secret, new Date(until).toISOString());
  return { ok: true, space: key };
});
