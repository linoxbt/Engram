/** Sharing a space: single-use invite links and member management. */
import { describe, expect, it } from "vitest";
import { acceptInvite, createInvite, createSpace, getSpace, listInvites, listMembers, previewInvite, removeMember, revokeInvite } from "../src/index";
import { setup } from "./helpers";

describe("space invites", () => {
  it("an invite adds one member once, and only a hash of the token is stored", async () => {
    const { b, space, user } = await setup();
    const { token, invite } = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const stored = (await getSpace(b, space.key))!.settings.invites!;
    expect(JSON.stringify(stored)).not.toContain(token.split(".")[1]);
    expect((await previewInvite(b, token)).spaceName).toBe("Test");

    const bea = await b.auth.signUp("bea@example.com", "password123", "Bea");
    expect(await acceptInvite(b, token, bea)).toEqual({ spaceKey: space.key, alreadyMember: false });
    expect((await b.teams.membership(space.teamId, bea.id))?.roles).toEqual(["member"]);
    expect((await getSpace(b, space.key))!.settings.people[bea.id]).toBe("Bea");
    expect(await listInvites(b, space.key)).toEqual([]);
    const cal = await b.auth.signUp("cal@example.com", "password123", "Cal");
    await expect(acceptInvite(b, token, cal)).rejects.toThrow(/invalid, used or expired/);
    expect(invite.email).toBeNull();
  });

  it("an email-bound invite only works for that address; revoked links stop working", async () => {
    const { b, space, user } = await setup();
    const bound = await createInvite(b, space.key, { email: "Dee@Example.com", createdBy: user.id });
    const eve = await b.auth.signUp("eve@example.com", "password123", "Eve");
    await expect(acceptInvite(b, bound.token, eve)).rejects.toThrow(/for dee@example.com/);
    const dee = await b.auth.signUp("dee@example.com", "password123", "Dee");
    await acceptInvite(b, bound.token, dee);

    const open = await createInvite(b, space.key, { email: null, createdBy: user.id });
    await revokeInvite(b, space.key, open.invite.id);
    await expect(acceptInvite(b, open.token, eve)).rejects.toThrow(/invalid/);
    await expect(previewInvite(b, `${space.key}.not-a-real-secret-at-all`)).rejects.toThrow(/invalid/);
  });

  it("owners remove members but cannot be removed; sandboxes cannot be shared", async () => {
    const { b, space, user } = await setup();
    const { token } = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const fay = await b.auth.signUp("fay@example.com", "password123", "Fay");
    await acceptInvite(b, token, fay);
    expect((await listMembers(b, space.key)).map((m) => [m.email, m.owner])).toEqual(expect.arrayContaining([["fay@example.com", false]]));
    await removeMember(b, space.key, fay.id);
    expect(await b.teams.membership(space.teamId, fay.id)).toBeNull();
    await expect(removeMember(b, space.key, user.id)).rejects.toThrow(/owner cannot be removed/);

    const sandbox = await createSpace(b, { name: "Lab", ownerId: user.id, sandbox: true });
    await expect(createInvite(b, sandbox.key, { email: null, createdBy: user.id })).rejects.toThrow(/private/);
  });
});
