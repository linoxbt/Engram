/**
 * What the dashboard routes hand back about other people (no Next.js imports, so it is unit-testable). Member
 * lists and pending invites carry more than the page needs: addresses, account IDs and invite token hashes.
 * Anyone who holds a token hash can confirm a guessed link offline, so only the owner's own fields leave here.
 */
import type { ChainEntry, PublicEntry } from "@engram/core";
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

/**
 * The chain as a viewer (the demo guest) may read it. /memories already shows a viewer each memory's text —
 * that is the demo — but it never shows `c.salt`, and neither may this. A salt beside a content hash is what
 * stops someone confirming a guessed text offline, so handing one out would undo the commitment for every
 * entry at once; the derived block and the embedding vector are not the verifier's business either. What is
 * left is exactly `PublicEntry`, which ChainVerifier already accepts, and the report then says plainly that
 * content hashes went unchecked.
 */
export function publicChainEntries(entries: ChainEntry[], viewer: boolean): (ChainEntry | PublicEntry)[] {
  if (!viewer) return entries;
  return entries.map((e) => ({ $id: e.$id, h: e.metadata.h, hash: e.metadata.hash }));
}
