/** Read-only demo guests on the local backend: creation, viewer membership, and the 24-hour clean-up. */
import { describe, expect, it, vi } from "vitest";
import { GUEST_EMAIL_DOMAIN, GUEST_TTL_MS, isOwnerRole, listSpacesForUser, membership } from "../src/index";
import { setup } from "./helpers";

describe("demo guests", () => {
  it("are signed-in, terms-accepted viewers that are never owners", async () => {
    const { b, space } = await setup();
    const { user, session } = await b.auth.createGuest();
    expect(user).toMatchObject({ name: "Guest", guest: true, termsAcceptedAt: expect.any(String) });
    expect(user.email.endsWith("@" + GUEST_EMAIL_DOMAIN)).toBe(true);
    expect(await b.auth.getUser(session.secret)).toMatchObject({ id: user.id, guest: true });
    // The session ends with the guest, not 30 days later.
    expect(Date.parse(session.expire) - Date.now()).toBeLessThanOrEqual(GUEST_TTL_MS);
    await b.teams.addMember(space.teamId, user.id, ["viewer"]);
    const m = await membership(b, space.key, user.id);
    expect(m?.roles).toEqual(["viewer"]);
    expect(isOwnerRole(m!.roles)).toBe(false);
    expect((await listSpacesForUser(b, user.id)).map((s) => s.key)).toEqual([space.key]);
  });

  it("each get their own account, and nobody can sign in as one with a password", async () => {
    const { b } = await setup();
    const a = await b.auth.createGuest();
    const c = await b.auth.createGuest();
    expect(a.user.id).not.toBe(c.user.id);
    await expect(b.auth.signIn(a.user.email, "password123")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("are deleted after 24 hours, oldest first and a bounded batch at a time; real accounts never", async () => {
    const { b, user: owner, space } = await setup();
    const old = await Promise.all([b.auth.createGuest(), b.auth.createGuest(), b.auth.createGuest()]);
    for (const g of old) await b.teams.addMember(space.teamId, g.user.id, ["viewer"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + GUEST_TTL_MS + 60_000);
      const fresh = await b.auth.createGuest();
      const cutoff = new Date(Date.now() - GUEST_TTL_MS).toISOString();
      expect(await b.auth.deleteGuests(cutoff, 2)).toBe(2);
      expect(await b.auth.deleteGuests(cutoff, 10)).toBe(1);
      expect(await b.auth.deleteGuests(cutoff, 10)).toBe(0);
      for (const g of old) {
        expect(await b.auth.getUser(g.session.secret)).toBeNull();
        expect(await membership(b, space.key, g.user.id)).toBeNull();
      }
      expect(await b.auth.getUser(fresh.session.secret)).not.toBeNull();
      expect(await b.auth.findUserByEmail(owner.email)).not.toBeNull();
      expect(await membership(b, space.key, owner.id)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
