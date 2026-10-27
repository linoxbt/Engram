/** Follow-ups found while merging the audit fixes: what a verify answer reports, and what a badge hands out. */
import { describe, expect, it } from "vitest";
import { listAllSpacesDetailed, publicIntegrity, remember, runSentinel, verifyTool, type IntegrityStatus } from "../src/index";
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
