import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EngramError, getBackend, isOwnerRole, membership, requireSpace, type SpaceInfo, type User } from "@engram/server";

export const SESSION_COOKIE = "engram_session";

export async function sessionSecret(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function currentUser(): Promise<User | null> {
  const secret = await sessionSecret();
  if (!secret) return null;
  try {
    return await getBackend().auth.getUser(secret);
  } catch {
    return null;
  }
}

/** For server components: redirect to login when signed out. */
export async function requireUserPage(next?: string): Promise<User> {
  const u = await currentUser();
  if (!u) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

/** For route handlers: throw a 401 when signed out. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new EngramError("unauthorized", "Sign in to continue.");
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

export async function setSession(secret: string, expire: string) {
  (await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expire),
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
