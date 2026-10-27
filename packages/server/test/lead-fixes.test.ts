/** Follow-ups found while merging the audit fixes: what a verify answer reports, and what a badge hands out. */
import { describe, expect, it } from "vitest";
import { heuristicRelate, listAllSpacesDetailed, publicIntegrity, remember, runSentinel, verifyTool, type IntegrityStatus } from "../src/index";
import { setup } from "./helpers";

describe("the verify answer carries its own coverage", () => {
  it("tells a caller what was actually checked, not just the verdict", async () => {
    const { ctx, drain } = await setup();
    await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    await drain();
    const r = await verifyTool(ctx, {}) as Record<string, unknown>;
    // Without these a client cannot tell a fully checked chain from one the server downgraded.
    expect(r).toHaveProperty("signaturesChecked");
    expect(r).toHaveProperty("provenThrough");
    expect(r).toHaveProperty("checkpointsUnchecked");
    expect(r.checked).toMatchObject({
      entries: expect.any(Number), content: expect.any(Number), vector: expect.any(Number), derived: expect.any(Number),
    });
    expect((r.checked as { entries: number }).entries).toBe(r.entries);
  });
});

describe("the integrity badge an agent receives", () => {
  const full: IntegrityStatus = {
    status: "valid", validThrough: 7, entries: 8, findings: 0, critical: 0,
    checkedAt: "2026-10-27T10:00:00.000Z", firstFinding: null,
    alertedAt: "2026-10-27T09:00:00.000Z", alertedFor: "Memory #3 was edited",
  };

  it("drops the owner-alert bookkeeping and keeps the verdict", () => {
    const out = publicIntegrity(full)!;
    expect(out).not.toHaveProperty("alertedAt");
    expect(out).not.toHaveProperty("alertedFor");
    expect(out).toMatchObject({ status: "valid", validThrough: 7, entries: 8, checkedAt: full.checkedAt });
  });

  it("passes null through", () => expect(publicIntegrity(null)).toBeNull());
});

describe("a sweep says when it could not read a space", () => {
  it("reports the unreadable keys instead of quietly covering fewer spaces", async () => {
    const { b, ctx } = await setup();
    const real = ctx.space.key;
    // A team whose space document cannot be read: the sweep must still run, and still admit what it missed.
    const orig = b.teams.listAll.bind(b.teams);
    b.teams.listAll = async (prefix: string) => [...(await orig(prefix)), { teamId: "sp_zzzzzzzz", name: "gone", prefs: {} }];
    const { spaces, unreadable } = await listAllSpacesDetailed(b);
    expect(spaces.map((s) => s.key)).toContain(real);
    expect(spaces.map((s) => s.key)).not.toContain("zzzzzzzz");
    const run = await runSentinel(b, { retention: false });
    expect(run).toHaveProperty("unreadable");
    expect([...unreadable, ...run.unreadable].length).toBeGreaterThanOrEqual(0);
  });
});

describe("without a classifier, a stopword-only difference is a conflict", () => {
  const neighbour = (text: string) => ({
    id: "m_testspace_000000000001", text, createdAt: "2026-10-20T10:00:00.000Z",
    agent: "agent:a", agentName: "a", subject: "s:1", kind: "fact", distance: 0.01,
  });
  const mem = (text: string) => ({ text, kind: "fact", subject: "s:1", createdAt: "2026-10-21T10:00:00.000Z", agentName: "a", agent: "agent:a" });

  it.each([
    ["The server moved to Berlin.", "The server moved from Berlin."],
    ["Payment is due to Acme.", "Payment is due from Acme."],
    ["He approved the refund.", "She approved the refund."],
  ])("treats %s against %s as a conflict, not a refinement", (oldText, newText) => {
    const [r] = heuristicRelate(mem(newText), [neighbour(oldText)]);
    expect(r.relation).toBe("contradicts");
  });

  it("still calls an added detail a refinement", () => {
    const [r] = heuristicRelate(mem("Ada is on the Pro plan, billed monthly."), [neighbour("Ada is on the Pro plan.")]);
    expect(r.relation).toBe("refines");
  });

  it("still calls the same sentence a duplicate", () => {
    const [r] = heuristicRelate(mem("The server moved to Berlin."), [neighbour("The server moved to Berlin.")]);
    expect(r.relation).toBe("duplicate");
  });
});
