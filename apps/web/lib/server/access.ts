/**
 * Who may do what, decided from the request's method and path (no Next.js imports, so it is unit-testable).
 * Used by the session helpers and the route wrappers.
 */
import { EngramError, type User } from "@engram/server";

/** Team role of read-only members: the demo guest. Never an owner role (see isOwnerRole). */
export const VIEWER_ROLE = "viewer";
export const isViewerRole = (roles: string[]) => roles.includes(VIEWER_ROLE);

export const READ_ONLY_MESSAGE = "This is a read-only demo. Create a free account to write memories, add agents or change settings.";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** POSTs that only read: searching memories, verifying the chain, fetching a proof. */
const READ_ONLY_POSTS = /^\/api\/app\/spaces\/[a-z0-9]+\/(recall|verify|memories\/[^/]+\/proof)$/;

export function isReadRequest(method: string, route: string): boolean {
  const m = method.toUpperCase();
  return READ_METHODS.has(m) || (m === "POST" && READ_ONLY_POSTS.test(route));
}

/** Viewers may read a space and nothing else: every write is 403 read_only. */
export function assertSpaceWriteAllowed(roles: string[], method: string, route: string) {
  if (isViewerRole(roles) && !isReadRequest(method, route)) throw new EngramError("read_only", READ_ONLY_MESSAGE);
}

/**
 * Account-level writes a guest may still make. Everything else a signed-in guest sends (creating spaces or agent
 * keys, accepting invites, renaming, passkeys, verification emails) is read_only. Signing out, signing in as
 * someone else and creating a real account do not need a session, so they are not limited here.
 */
const GUEST_WRITES = new Set(["POST /api/auth/terms"]);
export function assertGuestAllowed(user: Pick<User, "guest">, method: string, route: string) {
  if (user.guest && !isReadRequest(method, route) && !GUEST_WRITES.has(`${method.toUpperCase()} ${route}`)) {
    throw new EngramError("read_only", READ_ONLY_MESSAGE);
  }
}

/**
 * Calls an account that never accepted the Terms may still make: accept them, or delete itself. Reading who is
 * signed in (GET /api/auth/me) and signing out do not require a user at all, so they are never blocked.
 */
const TERMS_EXEMPT = new Set(["POST /api/auth/terms", "DELETE /api/auth/me"]);
export const TERMS_REQUIRED_MESSAGE = "Accept the Terms of Service and Privacy Policy to continue.";
export function assertTermsAccepted(user: Pick<User, "termsAcceptedAt">, method: string | null, route: string | null) {
  if (user.termsAcceptedAt) return;
  if (method && route && TERMS_EXEMPT.has(`${method.toUpperCase()} ${route}`)) return;
  throw new EngramError("terms_required", TERMS_REQUIRED_MESSAGE);
}
