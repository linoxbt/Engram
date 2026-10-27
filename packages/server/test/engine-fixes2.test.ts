/**
 * Engine fixes from the fourth audit: the duplicate fast path, verified as-of recall, the background
 * re-classification sweep, the rule-based classifier, supersession budgets, bounded erasure and bounded caches.
 */
import { describe, expect, it } from "vitest";
import {
  heuristicRelate, relate, remember, type Neighbour, type NewMemory,
} from "../src/index";
import { setup } from "./helpers";

const NEIGHBOUR = "m_testspace_000000000001";
const neighbour = (text: string, over: Partial<Neighbour> = {}): Neighbour => ({
  id: NEIGHBOUR, text, createdAt: "2026-10-20T10:00:00.000Z",
  agent: "agent:a", agentName: "agent-a", subject: "test:thing", kind: "fact", distance: 0.001, ...over,
});
const mem = (text: string, over: Partial<NewMemory> = {}): NewMemory => ({
  text, kind: "fact", subject: "test:thing", createdAt: "2026-10-21T10:00:00.000Z", agentName: "agent-a", agent: "agent:a", ...over,
});

describe("the duplicate fast path compares raw wording, not stopword-stripped wording", () => {
  // Every pair embeds almost identically and differs only in words the heuristic's own normaliser drops.
  const OPPOSITES: [string, string][] = [
    ["The server moved to Berlin.", "The server moved from Berlin."],
    ["Payment is due to Acme.", "Payment is due from Acme."],
    ["He approved the refund.", "She approved the refund."],
    ["Data flows from the cache to the DB.", "Data flows to the cache from the DB."],
  ];

  it.each(OPPOSITES)("%s is not a duplicate of %s", async (older, newer) => {
    const { ctx } = await setup();
    const res = await relate(ctx, mem(newer), [neighbour(older)]);
    const rel = res.relations.find((r) => r.id === NEIGHBOUR);
    expect(rel?.relation).not.toBe("duplicate");
  });

  it.each(OPPOSITES)("the rule-based classifier does not call %s a duplicate of %s", (older, newer) => {
    const [rel] = heuristicRelate(mem(newer), [neighbour(older)]);
    expect(rel.relation).not.toBe("duplicate");
  });

  it("the same statement is still a duplicate, ignoring case, spacing and trailing punctuation", async () => {
    const { ctx } = await setup();
    const res = await relate(ctx, mem("the server   MOVED to berlin"), [neighbour("The server moved to Berlin.")]);
    expect(res.relations[0]).toMatchObject({ relation: "duplicate", confidence: 1 });
    expect(res.via).toBe("fast");
    expect(heuristicRelate(mem("the server   MOVED to berlin"), [neighbour("The server moved to Berlin.")])[0].relation).toBe("duplicate");
  });

  it("an opposite fact written after the original is appended, not swallowed", async () => {
    const { ctx, drain } = await setup();
    const to = await remember(ctx, { text: "The server moved to Berlin.", subject: "test:thing" });
    const from = await remember(ctx, { text: "The server moved from Berlin.", subject: "test:thing" });
    expect(from.status).toBe("created");
    expect(from.id).not.toBe(to.id);
    const again = await remember(ctx, { text: "The server moved to Berlin.", subject: "test:thing" });
    expect(again.status).toBe("duplicate");
    expect(again.id).toBe(to.id);
    await drain();
  });
});
