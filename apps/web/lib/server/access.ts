/**
 * Who may do what, decided from the request's method and path (no Next.js imports, so it is unit-testable).
 * Used by the session helpers and the route wrappers.
 */
import { EngramError, type User } from "@engram/server";

/** Team role of read-only members: the demo guest. Never an owner role (see isOwnerRole). */
export const VIEWER_ROLE = "viewer";
export const isViewerRole = (roles: string[]) => roles.includes(VIEWER_ROLE);

export const READ_ONLY_MESSAGE = "This is a read-only demo. Create a free account to write memories, add agents or change settings.";
export const VIEWER_READ_MESSAGE = "This is a read-only demo. Create a free account to export a space, or to see its agents, recall log and members.";

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

const SPACE_PREFIX = /^\/api\/app\/spaces\/([^/]+)/;
/** A space route's path below /api/app/spaces/<key>; "" for the space itself, null when it is not a space route. */
function spaceSubRoute(route: string): string | null {
  const m = SPACE_PREFIX.exec(route);
  return m ? route.slice(m[0].length) : null;
}

/**
 * What an untrusted reader (the demo guest) may read in a space. "Every GET" would be wrong: the product's claim
 * is that untrusted parties see headers and hashes only, and /export hands out every memory's text AND its
 * content salt, the one thing that keeps content hashes from being guessed offline. Decided per route, so a new
 * route is refused until it is listed here on purpose.
 */
const VIEWER_READS = new Set([
  "",            // the space itself (settings, the caller's own role)
  "/overview", "/feed", "/gaps", "/subjects", "/timeline",
  "/memories", "/chain", "/concepts", "/conflicts",
  "/checkpoints", // signed public artefacts: hashes and signatures, no text
]);
/** One entry, its inclusion proof, or the members of one concept. */
const VIEWER_READ_PATTERNS = [/^\/memories\/[^/]+$/, /^\/memories\/[^/]+\/proof$/, /^\/concepts\/[^/]+$/];
/** The POSTs that only read: searching and as-of recall, verifying (cached for viewers), fetching a proof. */
const VIEWER_POSTS = new Set(["/recall", "/verify"]);
const VIEWER_POST_PATTERNS = [/^\/memories\/[^/]+\/proof$/];
/**
 * Deliberately not readable by a viewer: /export (text and salts), /recalls (who asked what), /agents and
 * /agents/find (the key registry), /members (other people's addresses), /lab (the sandbox's attacks).
 */

export function assertViewerReadAllowed(user: Pick<User, "guest">, access: { viewer: boolean }, method: string, route: string): void {
  if (!access.viewer && !user.guest) return;
  const rest = spaceSubRoute(route);
  if (rest === null) return; // not a space route: assertGuestAllowed decides
  const m = method.toUpperCase();
  const ok = READ_METHODS.has(m)
    ? VIEWER_READS.has(rest) || VIEWER_READ_PATTERNS.some((re) => re.test(rest))
    : m === "POST" && (VIEWER_POSTS.has(rest) || VIEWER_POST_PATTERNS.some((re) => re.test(rest)));
  if (!ok) throw new EngramError("read_only", VIEWER_READ_MESSAGE);
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
