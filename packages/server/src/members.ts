/**
 * Sharing a space: single-use invite links and member management. Appwrite's own team invitations need the
 * inviter to hold Appwrite's "owner" role, which space owners deliberately do not have (it would let them
 * rewrite server-owned settings), so the server issues and redeems invites itself. Only a hash of each token
 * is stored; the link is shown once.
 */
import { sha256Hex, timingSafeEqualHex, toBase64 } from "@engram/core";
import type { Backend, TeamMember, User } from "./backend/types";
import { revokeAgentsCreatedBy } from "./agents";
import { getConfig } from "./config";
import { EngramError, isConflict } from "./errors";
import type { SpaceInvite } from "./settings";
import { getSpace, isOwnerRole, requireSpace, updateSettings, updateSpaceState } from "./spaces";

export const MEMBER_ROLE = "member";
/** Team role of read-only guests of the public demo (contract 3). */
const VIEWER_ROLE = "viewer";
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

/** Confirmed members. Read-only guests ("viewer", the public demo) are not listed. */
export async function listMembers(b: Backend, key: string): Promise<(TeamMember & { owner: boolean })[]> {
  const s = await requireSpace(b, key);
  return (await b.teams.listMembers(s.teamId)).filter((m) => !m.roles.includes(VIEWER_ROLE)).map((m) => ({ ...m, owner: isOwnerRole(m.roles) }));
}

export async function listInvites(b: Backend, key: string): Promise<PublicInvite[]> {
  return live((await requireSpace(b, key)).settings.invites).map(pub);
}

/** A link of the form <app>/invite?token=<space>.<secret>. `email` limits who can redeem it. */
export async function createInvite(b: Backend, key: string, args: { email: string | null; createdBy: string }): Promise<{ invite: PublicInvite; token: string }> {
  const s = await requireSpace(b, key);
  if (s.settings.sandbox) throw new EngramError("bad_request", "Sandboxes are private to their owner.");
  const tooMany = () => new EngramError("bad_request", `A space can have at most ${MAX_PENDING} pending invites. Revoke some first.`);
  if (live(s.settings.invites).length >= MAX_PENDING) throw tooMany();
  const secret = randomToken(32);
  const now = new Date();
  const invite: SpaceInvite = {
    id: randomToken(9), tokenHash: await tokenHash(secret), email: args.email?.trim().toLowerCase() || null,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(), createdBy: args.createdBy,
  };
  let full = false;
  await updateSpaceState(b, key, (st) => {
    const pending = live(st.invites);
    full = pending.length >= MAX_PENDING;
    return full ? null : { invites: [...pending, invite] };
  });
  if (full) throw tooMany();
  return { invite: pub(invite), token: `${key}.${secret}` };
}

/**
 * Each invite has a create-first "used" marker file: whoever creates it first (an accept, or the owner revoking)
 * wins, so two accepts of one link cannot both succeed and a link revoked mid-accept is not redeemed.
 */
const usedMarkerId = (key: string, inviteId: string) => `ivc_${key}_${inviteId}`;
async function claimInvite(b: Backend, key: string, inviteId: string, by: string): Promise<boolean> {
  const id = usedMarkerId(key, inviteId);
  try {
    await b.files.put(getConfig().appwrite.checkpointsBucket, id, `${id}.json`, new TextEncoder().encode(JSON.stringify({ by, at: new Date().toISOString() })), []);
    return true;
  } catch (e) {
    if (isConflict(e)) return false;
    throw e;
  }
}
const inviteUsed = async (b: Backend, key: string, inviteId: string) => !!(await b.files.get(getConfig().appwrite.checkpointsBucket, usedMarkerId(key, inviteId)));
/** Remove one invite (and any expired ones) from the latest list, never from a stale copy. */
const dropInvite = (b: Backend, key: string, id: string) =>
  updateSpaceState(b, key, (st) => {
    const keep = live(st.invites).filter((i) => i.id !== id);
    return keep.length === st.invites.length ? null : { invites: keep };
  });

export async function revokeInvite(b: Backend, key: string, id: string) {
  await requireSpace(b, key);
  await claimInvite(b, key, id, "revoked");
  await dropInvite(b, key, id);
}

async function findInvite(b: Backend, token: string) {
  const m = /^([a-z0-9]{8})\.([A-Za-z0-9_-]{20,128})$/.exec(token.trim());
  const invalid = new EngramError("not_found", "This invite link is invalid, used or expired. Ask the space owner for a new one.");
  if (!m) throw invalid;
  const space = await getSpace(b, m[1]);
  if (!space) throw invalid;
  const h = await tokenHash(m[2]);
  const invite = live(space.settings.invites).find((i) => timingSafeEqualHex(i.tokenHash, h));
  if (!invite || (await inviteUsed(b, space.key, invite.id))) throw invalid;
  return { space, invite, invalid };
}

/** What the invite page shows before someone accepts. */
export async function previewInvite(b: Backend, token: string) {
  const { space, invite } = await findInvite(b, token);
  return { spaceName: space.settings.name, invitedBy: space.settings.people[invite.createdBy] ?? "the space owner", email: invite.email, expiresAt: invite.expiresAt };
}

export async function acceptInvite(b: Backend, token: string, user: User): Promise<{ spaceKey: string; alreadyMember: boolean }> {
  const { space, invite, invalid } = await findInvite(b, token);
  if (invite.email && invite.email !== user.email.toLowerCase()) {
    throw new EngramError("forbidden", `This invite is for ${invite.email}. Sign in with that address to accept it.`);
  }
  // An unverified address proves nothing: anyone can sign up with someone else's email.
  if (invite.email && !user.emailVerified) {
    throw new EngramError("forbidden", `This invite is for ${invite.email}. Verify that address first (Account settings), then open the link again.`);
  }
  const existing = await b.teams.membership(space.teamId, user.id);
  // Single use: the invite is spent whether or not the person was already a member.
  if (!(await claimInvite(b, space.key, invite.id, user.id))) throw invalid;
  if (!existing) await b.teams.addMember(space.teamId, user.id, [MEMBER_ROLE]);
  await dropInvite(b, space.key, invite.id);
  const fresh = (await getSpace(b, space.key)) ?? space;
  await updateSettings(b, space.key, { people: { ...fresh.settings.people, [user.id]: user.name || user.email } });
  return { spaceKey: space.key, alreadyMember: !!existing };
}

export async function removeMember(b: Backend, key: string, userId: string) {
  const s = await requireSpace(b, key);
  const m = await b.teams.membership(s.teamId, userId);
  if (!m) throw new EngramError("not_found", "Not a member of this space.");
  if (isOwnerRole(m.roles)) throw new EngramError("bad_request", "The owner cannot be removed. Delete the space instead.");
  await b.teams.removeMember(s.teamId, userId);
  // Keys they created would otherwise keep writing to the space after they lost access to it.
  await revokeAgentsCreatedBy(b, key, userId);
}
