/** Who may hold agent keys, single-use invites, and paging of the agent registry. */
import { describe, expect, it } from "vitest";
import { agentId, count8, iso } from "@engram/core";
import {
  acceptInvite, authAgent, createAgent, createInvite, createSpace, exportSpace, getSpace, listAgents, listInvites, listMembers, removeMember, revokeAgentsCreatedBy, revokeInvite,
  type AgentMeta, type Backend,
} from "../src/index";
import { setup } from "./helpers";

describe("agent registry", () => {
  it("lists every agent of a space, past the first page", async () => {
    const { b, space } = await setup();
    const meta = (i: number): AgentMeta => ({
      space: space.key, name: `bot ${i}`, description: "x", keyPrefix: `eng_${String(i).padStart(4, "0")}`, keyHash: "00", scopes: ["recall"], publicKey: null,
      status: "active", createdAt: iso(), createdBy: "seed", lastSeenAt: null, writes: count8(0), recalls: count8(0),
    });
    for (let i = 0; i < 230; i++) await b.vectors.create<AgentMeta>("agents", agentId(space.key), { embeddings: new Array(384).fill(0.01), metadata: meta(i) });
    await createAgent(b, space, { name: "last", description: "the newest", scopes: ["recall"] }, "seed");
    const all = await listAgents(b, space.key);
    expect(all).toHaveLength(231);
    expect(all.at(-1)!.name).toBe("last");
  });
});

describe("offboarding revokes keys", () => {
  it("removing a member revokes the keys they created in that space, and only those", async () => {
    const { b, space, user } = await setup();
    const { token } = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const gil = await b.auth.signUp("gil@example.com", "password123", "Gil");
    await acceptInvite(b, token, gil);
    const gilKey = await createAgent(b, space, { name: "gil-bot", description: "Gil's helper", scopes: ["recall"] }, `user:${gil.id}`);
    const ownerKey = await createAgent(b, space, { name: "owner-bot", description: "Owner's helper", scopes: ["recall"] }, `user:${user.id}`);
    const other = await createSpace(b, { name: "Other", ownerId: gil.id });
    const elsewhere = await createAgent(b, other, { name: "gil-elsewhere", description: "In Gil's own space", scopes: ["recall"] }, `user:${gil.id}`);
    expect((await authAgent(b, `Bearer ${gilKey.key}`)).actor).toBe(gilKey.agent.id);

    await removeMember(b, space.key, gil.id);
    await expect(authAgent(b, `Bearer ${gilKey.key}`)).rejects.toThrow(/revoked/);
    expect((await authAgent(b, `Bearer ${ownerKey.key}`)).actor).toBe(ownerKey.agent.id);
    expect((await authAgent(b, `Bearer ${elsewhere.key}`)).actor).toBe(elsewhere.agent.id);
    expect((await listAgents(b, space.key)).find((a) => a.name === "gil-bot")!.status).toBe("revoked");
  });

  it("revokes across every space when no space is given (account deletion)", async () => {
    const { b, space, user } = await setup();
    const hal = await b.auth.signUp("hal@example.com", "password123", "Hal");
    const s2 = await createSpace(b, { name: "Two", ownerId: user.id });
    const a1 = await createAgent(b, space, { name: "h1", description: "one", scopes: ["recall"] }, `user:${hal.id}`);
    const a2 = await createAgent(b, s2, { name: "h2", description: "two", scopes: ["recall"] }, `user:${hal.id}`);
    expect(await revokeAgentsCreatedBy(b, null, hal.id)).toBe(2);
    await expect(authAgent(b, `Bearer ${a1.key}`)).rejects.toThrow(/revoked/);
    await expect(authAgent(b, `Bearer ${a2.key}`)).rejects.toThrow(/revoked/);
    expect(await revokeAgentsCreatedBy(b, space.key, `user:${hal.id}`)).toBe(0);
  });
});

describe("invites are single use, atomically", () => {
  it("two concurrent accepts of one link (in two processes): exactly one succeeds", async () => {
    const { b, space, user } = await setup();
    const { token } = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const ida = await b.auth.signUp("ida@example.com", "password123", "Ida");
    const jo = await b.auth.signUp("jo@example.com", "password123", "Jo");
    const res = await Promise.allSettled([acceptInvite(b, token, ida), acceptInvite({ ...b }, token, jo)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/invalid, used or expired/);
    const members = (await listMembers(b, space.key)).map((m) => m.email);
    expect(members.filter((e) => e === "ida@example.com" || e === "jo@example.com")).toHaveLength(1);
    expect(await listInvites(b, space.key)).toEqual([]);
  });

  it("an accept never brings back an invite revoked meanwhile, and a revoke mid-accept wins", async () => {
    const { b, space, user } = await setup();
    const a = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const c = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const kim = await b.auth.signUp("kim@example.com", "password123", "Kim");
    await Promise.all([acceptInvite(b, a.token, kim), revokeInvite({ ...b }, space.key, c.invite.id)]);
    expect(await listInvites(b, space.key)).toEqual([]);

    const d = await createInvite(b, space.key, { email: null, createdBy: user.id });
    const lou = await b.auth.signUp("lou@example.com", "password123", "Lou");
    // The owner revokes after the accept has looked the invite up but before it is spent.
    const teams = Object.assign(Object.create(b.teams), {
      membership: async (t: string, u: string) => { await revokeInvite(b, space.key, d.invite.id); return b.teams.membership(t, u); },
    }) as Backend["teams"];
    await expect(acceptInvite({ ...b, teams }, d.token, lou)).rejects.toThrow(/invalid, used or expired/);
    expect(await b.teams.membership(space.teamId, lou.id)).toBeNull();
  });

  it("an export shows pending invites to the owner only", async () => {
    const { b, space, user, ctx } = await setup();
    await createInvite(b, space.key, { email: null, createdBy: user.id });
    const fresh = { ...ctx, space: (await getSpace(b, space.key))! };
    expect((await exportSpace(fresh)).settings).not.toHaveProperty("invites");
    expect((await exportSpace(fresh, { owner: true })).settings).toHaveProperty("invites", [expect.objectContaining({ createdBy: user.id })]);
  });

  it("read-only guests are not listed as members", async () => {
    const { b, space } = await setup();
    const guest = await b.auth.signUp("guest@example.com", "password123", "Guest");
    await b.teams.addMember(space.teamId, guest.id, ["viewer"]);
    expect((await listMembers(b, space.key)).map((m) => m.email)).not.toContain("guest@example.com");
  });
});
