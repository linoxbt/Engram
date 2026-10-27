/**
 * Engine fixes from the fourth audit: the duplicate fast path, verified as-of recall, the background
 * re-classification sweep, the rule-based classifier, supersession budgets, bounded erasure and bounded caches.
 */
import { describe, expect, it } from "vitest";
import { iso } from "@engram/core";
import {
  append, authAgent, capSupersessions, createAgent, embedDocument, getEntry, getSpace, heuristicRelate, listConflicts, notesOf, recall, relate, remember,
  retryRelate, runCheckpoint, SUPERSEDE_PER_HOUR, sweepPendingRelate, verifyStoredSpace, verifyThrottled,
  type Neighbour, type NewMemory, type Scope,
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

describe("verified as-of recall is behind the verify scope and the verify budget", () => {
  /** A space with a signed checkpoint, plus an agent key with the given scopes. */
  const verifiableSpace = async (scopes: Scope[]) => {
    const { b, ctx, space, keys, drain } = await setup();
    await remember(ctx, { text: "Ada is on the Pro plan.", subject: "customer:ada" }, { createdAt: "2026-10-19T09:01:00.000Z" });
    await remember(ctx, { text: "Ada prefers email.", subject: "customer:ada" }, { createdAt: "2026-10-19T10:00:00.000Z" });
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    await drain();
    const fresh = (await getSpace(b, space.key))!;
    const { key } = await createAgent(b, fresh, { name: "reader", description: "a reading agent", scopes }, "test");
    const agent = { ...(await authAgent(b, key, () => undefined)), space: fresh };
    return { b, person: { ...ctx, space: fresh }, agent };
  };
  const asOf = { query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00.000Z", verify: true };

  it("an agent key without the verify scope cannot replay history through recall", async () => {
    const { agent } = await verifiableSpace(["remember", "recall"]);
    await expect(recall(agent, asOf, { log: false })).rejects.toMatchObject({ code: "forbidden" });
    // The unverified as-of answer is still allowed.
    expect((await recall(agent, { ...asOf, verify: false }, { log: false })).mode).toBe("as-of");
  });

  it("a second verified recall inside the verify window is refused, as /verify would be", async () => {
    const { agent } = await verifiableSpace(["remember", "recall", "verify"]);
    const first = await recall(agent, asOf, { log: false });
    expect(first.mode).toBe("as-of-verified");
    expect(first.integritySource).toBe("replayed");
    await expect(recall(agent, asOf, { log: false })).rejects.toMatchObject({ code: "rate_limited" });
    // The same budget: /verify is spent too.
    await expect(verifyThrottled(agent, {})).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("a verified recall spends the budget only for agents, so the dashboard's time page keeps working", async () => {
    const { person } = await verifiableSpace(["recall", "verify"]);
    expect((await recall(person, asOf, { log: false })).mode).toBe("as-of-verified");
    expect((await recall(person, asOf, { log: false })).mode).toBe("as-of-verified");
  });
});

describe("a duplicate found by the background re-check is repaired, not dropped", () => {
  const TEXT = "Invoices go out on the first of the month.";

  it("retires the later copy in favour of the original and records why", async () => {
    const { b, ctx, drain } = await setup();
    const first = await remember(ctx, { text: TEXT, subject: "policy:billing" });
    // The first classification timed out, so the write landed before anything knew it said nothing new.
    const second = await remember(ctx, { text: TEXT, subject: "policy:billing" }, { skipRelate: true });
    expect(second.status).toBe("created");
    await drain();

    await retryRelate(ctx, second.id, await embedDocument(ctx, TEXT), { text: TEXT, kind: "fact", subject: "policy:billing" });

    const later = (await getEntry(b, second.id))!.metadata;
    expect(later.d.status).toBe("superseded");
    expect(later.d.supersededBy).toBe(first.id);
    expect(notesOf(later.d)[first.id]).toMatchObject({ relation: "duplicate" });
    expect(later.d.relateStatus).toBe("done");
    // The original is untouched and still the live answer.
    expect((await getEntry(b, first.id))!.metadata.d.status).toBe("active");
    expect((await verifyStoredSpace(b, ctx.space)).findings).toEqual([]);
  });
});

describe("the pending-classification sweep always makes progress", () => {
  it("gives up on entries pending far too long so they stop holding the oldest-first window", async () => {
    const { b, ctx } = await setup();
    const at = (hours: number) => iso(Date.now() - hours * 3_600_000);
    const pending = async (text: string, createdAt: string) =>
      (await append(ctx, { op: "remember", kind: "fact", subject: "customer:ada", text, vector: await embedDocument(ctx, text), createdAt, relateStatus: "pending" })).id;
    const stuck = [];
    // Five entries stuck since long before the give-up point: exactly the sweep's page size.
    for (let i = 0; i < 5; i++) stuck.push(await pending(`Ada opened support ticket number ${i}.`, at(72 - i)));
    const recent = await pending("Ada moved to the Basic plan.", at(1));

    const space = (await getSpace(b, ctx.space.key))!;
    expect(await sweepPendingRelate(b, space)).toBe(0);
    for (const id of stuck) expect((await getEntry(b, id))!.metadata.d.relateStatus).toBe("skipped");
    // With the window free, the next sweep reaches the entry behind them.
    expect(await sweepPendingRelate(b, space)).toBe(1);
    expect((await getEntry(b, recent))!.metadata.d.relateStatus).toBe("done");
  });
});

describe("with no classifier model a changed fact reaches the conflict inbox", () => {
  // Six realistic updates, none of which uses an explicit change verb: the attribute stays, the value does not.
  const UPDATES: [string, string][] = [
    ["The widget color is blue.", "The widget color is red."],
    ["The payout address is 0xAAA1.", "The payout address is 0xBBB2."],
    ["The deploy status is green.", "The deploy status is red."],
    ["The primary region is Frankfurt.", "The primary region is London."],
    ["The retry limit is 3.", "The retry limit is 10."],
    ["Ada is on the Pro plan.", "Ada is on the Basic plan."],
  ];

  it.each(UPDATES)("%s then %s is a conflict, not a refinement", (older, newer) => {
    const [rel] = heuristicRelate(mem(newer), [neighbour(older, { distance: 0.3 })]);
    expect(rel.relation).toBe("contradicts");
  });

  it("a statement that only adds detail is still a refinement", () => {
    const [rel] = heuristicRelate(
      mem("The widget color is blue, matching the 2024 catalogue."),
      [neighbour("The widget color is blue.", { distance: 0.3 })]);
    expect(rel.relation).toBe("refines");
  });

  it("two unrelated facts about different things stay unrelated", () => {
    const [rel] = heuristicRelate(
      mem("The build pipeline runs every Tuesday night."),
      [neighbour("The widget color is blue.", { distance: 0.6 })]);
    expect(rel.relation).toBe("unrelated");
  });

  it("the changed value lands in the conflict inbox end to end", async () => {
    const { b, ctx, drain } = await setup();
    await remember(ctx, { text: "The primary region is Frankfurt.", subject: "infra:eu" });
    await remember(ctx, { text: "The primary region is London.", subject: "infra:eu" });
    await drain();
    const { pairs } = await listConflicts({ ...ctx, space: (await getSpace(b, ctx.space.key))! });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].via).toBe("heuristic");
  });
});

describe("the supersession cap holds under concurrency", () => {
  const sup = (id: string) => ({ id, relation: "supersedes" as const, confidence: 0.9, reason: "Reports a change." });

  it("ten writes racing each other retire ten memories, not twenty", async () => {
    const { ctx } = await setup();
    const id = (n: number) => `m_${ctx.space.key}_${String(n).padStart(12, "0")}`;
    // Each of ten concurrent writes is classified as superseding two neighbours: 20 wanted, 10 allowed.
    const batches = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      capSupersessions(ctx, "a_oneagent", [sup(id(i * 2)), sup(id(i * 2 + 1))])));
    const retired = batches.flat().filter((r) => r.relation === "supersedes");
    expect(retired).toHaveLength(SUPERSEDE_PER_HOUR);
    // Everything over the cap becomes a conflict for a person, never a silent drop.
    expect(batches.flat().filter((r) => r.relation === "contradicts")).toHaveLength(10);
    // Another writer's budget is its own.
    expect((await capSupersessions(ctx, "a_someoneelse", [sup(id(99))])).map((r) => r.relation)).toEqual(["supersedes"]);
  });
});
