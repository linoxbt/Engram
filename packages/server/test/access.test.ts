/** Who may hold agent keys, single-use invites, and paging of the agent registry. */
import { describe, expect, it } from "vitest";
import { agentId, count8, iso } from "@engram/core";
import { createAgent, listAgents, type AgentMeta } from "../src/index";
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
