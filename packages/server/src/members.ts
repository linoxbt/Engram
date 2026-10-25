/**
 * Sharing a space: single-use invite links and member management. Appwrite's own team invitations need the
 * inviter to hold Appwrite's "owner" role, which space owners deliberately do not have (it would let them
 * rewrite server-owned settings), so the server issues and redeems invites itself. Only a hash of each token
 * is stored; the link is shown once.
 */
import { sha256Hex, timingSafeEqualHex, toBase64 } from "@engram/core";
import type { Backend, TeamMember, User } from "./backend/types";
import { EngramError } from "./errors";
import type { SpaceInvite } from "./settings";
import { getSpace, isOwnerRole, requireSpace, updateSettings } from "./spaces";

export const MEMBER_ROLE = "member";
const INVITE_DAYS = 7;
const MAX_PENDING = 20;

export interface PublicInvite { id: string; email: string | null; createdAt: string; expiresAt: string }
const pub = (i: SpaceInvite): PublicInvite => ({ id: i.id, email: i.email, createdAt: i.createdAt, expiresAt: i.expiresAt });
const live = (invites: SpaceInvite[] | undefined) => (invites ?? []).filter((i) => Date.parse(i.expiresAt) > Date.now());
const tokenHash = (secret: string) => sha256Hex("engram:invite:v1:" + secret);
/** URL-safe random string (base64url, no padding). */
function randomToken(bytes: number) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function listMembers(b: Backend, key: string): Promise<(TeamMember & { owner: boolean })[]> {
  const s = await requireSpace(b, key);
  return (await b.teams.listMembers(s.teamId)).map((m) => ({ ...m, owner: isOwnerRole(m.roles) }));
}

export async function listInvites(b: Backend, key: string): Promise<PublicInvite[]> {
  return live((await requireSpace(b, key)).settings.invites).map(pub);
}

/** A link of the form <app>/invite?token=<space>.<secret>. `email` limits who can redeem it. */
export async function createInvite(b: Backend, key: string, args: { email: string | null; createdBy: string }): Promise<{ invite: PublicInvite; token: string }> {
  const s = await requireSpace(b, key);
  if (s.settings.sandbox) throw new EngramError("bad_request", "Sandboxes are private to their owner.");
  const pending = live(s.settings.invites);
  if (pending.length >= MAX_PENDING) throw new EngramError("bad_request", `A space can have at most ${MAX_PENDING} pending invites. Revoke some first.`);
  const secret = randomToken(32);
  const now = new Date();
  const invite: SpaceInvite = {
    id: randomToken(9), tokenHash: await tokenHash(secret), email: args.email?.trim().toLowerCase() || null,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(), createdBy: args.createdBy,
  };
  await updateSettings(b, key, { invites: [...pending, invite] });
  return { invite: pub(invite), token: `${key}.${secret}` };
}

export async function revokeInvite(b: Backend, key: string, id: string) {
  const s = await requireSpace(b, key);
  await updateSettings(b, key, { invites: live(s.settings.invites).filter((i) => i.id !== id) });
}

async function findInvite(b: Backend, token: string) {
  const m = /^([a-z0-9]{8})\.([A-Za-z0-9_-]{20,128})$/.exec(token.trim());
  const invalid = new EngramError("not_found", "This invite link is invalid, used or expired. Ask the space owner for a new one.");
  if (!m) throw invalid;
  const space = await getSpace(b, m[1]);
  if (!space) throw invalid;
  const h = await tokenHash(m[2]);
  const invite = live(space.settings.invites).find((i) => timingSafeEqualHex(i.tokenHash, h));
  if (!invite) throw invalid;
  return { space, invite };
}

/** What the invite page shows before someone accepts. */
export async function previewInvite(b: Backend, token: string) {
  const { space, invite } = await findInvite(b, token);
  return { spaceName: space.settings.name, invitedBy: space.settings.people[invite.createdBy] ?? "the space owner", email: invite.email, expiresAt: invite.expiresAt };
}

export async function acceptInvite(b: Backend, token: string, user: User): Promise<{ spaceKey: string; alreadyMember: boolean }> {
  const { space, invite } = await findInvite(b, token);
  if (invite.email && invite.email !== user.email.toLowerCase()) {
    throw new EngramError("forbidden", `This invite is for ${invite.email}. Sign in with that address to accept it.`);
  }
  const existing = await b.teams.membership(space.teamId, user.id);
  if (!existing) await b.teams.addMember(space.teamId, user.id, [MEMBER_ROLE]);
  // Single use: the invite goes whether or not the person was already a member.
  await updateSettings(b, space.key, {
    invites: live(space.settings.invites).filter((i) => i.id !== invite.id),
    people: { ...space.settings.people, [user.id]: user.name || user.email },
  });
  return { spaceKey: space.key, alreadyMember: !!existing };
}

export async function removeMember(b: Backend, key: string, userId: string) {
  const s = await requireSpace(b, key);
  const m = await b.teams.membership(s.teamId, userId);
  if (!m) throw new EngramError("not_found", "Not a member of this space.");
  if (isOwnerRole(m.roles)) throw new EngramError("bad_request", "The owner cannot be removed. Delete the space instead.");
  await b.teams.removeMember(s.teamId, userId);
}
