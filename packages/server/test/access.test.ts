/** Who may hold agent keys, single-use invites, and paging of the agent registry. */
import { describe, expect, it } from "vitest";
import { agentId, count8, iso } from "@engram/core";
import { acceptInvite, authAgent, createAgent, createInvite, createSpace, listAgents, removeMember, revokeAgentsCreatedBy, type AgentMeta } from "../src/index";
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
