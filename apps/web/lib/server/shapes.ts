/**
 * What the dashboard routes hand back about other people (no Next.js imports, so it is unit-testable). Member
 * lists and pending invites carry more than the page needs: addresses, account IDs and invite token hashes.
 * Anyone who holds a token hash can confirm a guessed link offline, so only the owner's own fields leave here.
 */
import type { PublicInvite, SpaceInvite, TeamMember } from "@engram/server";

type Member = TeamMember & { owner: boolean };
export type PublicMember = Omit<Member, "userId" | "email"> & { userId?: string; email?: string };

/** Other members' addresses and account IDs are the owner's business; everyone else sees names and roles. */
export function publicMembers(members: Member[], owner: boolean): PublicMember[] {
  if (owner) return members;
  return members.map(({ userId: _id, email: _email, ...m }) => m);
}

/** The same shape /members uses: never `tokenHash` (an offline check for a guessed link) nor `createdBy`. */
export const publicInvites = (invites: SpaceInvite[] | undefined): PublicInvite[] =>
  (invites ?? []).map(({ id, email, createdAt, expiresAt }) => ({ id, email, createdAt, expiresAt }));
