import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EngramError, getBackend, isEngramError, isOwnerRole, membership, requireSpace, type SpaceInfo, type User } from "@engram/server";
import { assertTermsAccepted } from "./access";
import { currentRequest } from "./request";

const PROD = process.env.NODE_ENV === "production";
/**
 * `__Host-` makes the browser insist on Secure, Path=/ and no Domain, so a sibling subdomain cannot set or shadow
 * it. Browsers accept Secure cookies from http://localhost, so the production build works there too; `next dev`
 * keeps the plain name so it also works over plain HTTP on a LAN address.
 */
export const SESSION_COOKIE = PROD ? "__Host-engram_session" : "engram_session";
/** The name before the rename: still read, and moved to the new name, so nobody is signed out by the change. */
const LEGACY_COOKIE = "engram_session";
/** The cookie never outlives this, whatever session length Appwrite is configured with. */
export const SESSION_MAX_AGE_S = 30 * 86_400;

export async function sessionSecret(): Promise<string | null> {
  const jar = await cookies();
  const current = jar.get(SESSION_COOKIE)?.value;
  if (current) return current;
  if (LEGACY_COOKIE === SESSION_COOKIE) return null;
  const legacy = jar.get(LEGACY_COOKIE)?.value;
  if (!legacy) return null;
  // Migrate once. Cookies can only be written from route handlers; elsewhere (page rendering) the old cookie keeps
  // working until the next API call moves it.
  try {
    writeCookie(jar, legacy, new Date(Date.now() + SESSION_MAX_AGE_S * 1000));
    jar.delete(LEGACY_COOKIE);
  } catch { /* read-only here */ }
  return legacy;
}

async function lookupUser(): Promise<User | null> {
  const secret = await sessionSecret();
  if (!secret) return null;
  try {
    return await getBackend().auth.getUser(secret);
  } catch (e) {
    // Only an invalid session means "signed out"; an outage must not look like one.
    if (isEngramError(e) && e.code === "unauthorized") return null;
    throw e;
  }
}

/** The signed-in user, looked up once per API request. */
export async function currentUser(): Promise<User | null> {
  const r = currentRequest();
  if (!r) return lookupUser();
  r.user ??= lookupUser();
  return r.user;
}

/** For server components: redirect to login when signed out, and to the Terms when they were never accepted. */
export async function requireUserPage(next?: string): Promise<User> {
  const u = await currentUser();
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  if (!u) redirect(`/login${q}`);
  if (!u.termsAcceptedAt) redirect(`/accept-terms${q}`);
  return u;
}

/** For route handlers: 401 when signed out, 403 terms_required when the Terms were never accepted. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new EngramError("unauthorized", "Sign in to continue.");
  const r = currentRequest();
  // Accounts made directly against Appwrite never saw the Terms: every call but accepting them (or deleting the
  // account) is refused until they do.
  assertTermsAccepted(u, r?.method ?? null, r?.route ?? null);
  return u;
}

export interface SpaceAccess { user: User; space: SpaceInfo; roles: string[]; owner: boolean }

export async function requireSpaceAccess(key: string): Promise<SpaceAccess> {
  const user = await requireUser();
  const b = getBackend();
  const m = await membership(b, key, user.id);
  if (!m) throw new EngramError("not_found", "Space not found.");
  const space = await requireSpace(b, key);
  return { user, space, roles: m.roles, owner: isOwnerRole(m.roles) };
}

/** Switch the browser to a new session and end the one it replaces (a re-authentication would otherwise leave it open). */
export async function replaceSession(secret: string, expire: string) {
  const old = await sessionSecret();
  await setSession(secret, expire);
  if (old && old !== secret) await getBackend().auth.signOut(old).catch(() => undefined);
}

type Jar = Awaited<ReturnType<typeof cookies>>;
function writeCookie(jar: Jar, secret: string, expires: Date) {
  jar.set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function setSession(secret: string, expire: string) {
  const jar = await cookies();
  const cap = Date.now() + SESSION_MAX_AGE_S * 1000;
  const until = Date.parse(expire);
  writeCookie(jar, secret, new Date(Number.isFinite(until) ? Math.min(until, cap) : cap));
  if (LEGACY_COOKIE !== SESSION_COOKIE && jar.get(LEGACY_COOKIE)) jar.delete(LEGACY_COOKIE);
}

export async function clearSession() {
  const jar = await cookies();
  // A __Host- cookie is only replaced by one that is Secure with Path=/ too, so the deletion says so.
  jar.delete({ name: SESSION_COOKIE, path: "/", secure: PROD, httpOnly: true, sameSite: "lax" });
  if (LEGACY_COOKIE !== SESSION_COOKIE && jar.get(LEGACY_COOKIE)) jar.delete(LEGACY_COOKIE);
}
