import { describe, expect, it } from "vitest";
import { verifyProofHex, seqOf, ATTACKS } from "@engram/core";
import {
  remember, recall, forget, resolveConflict, timeline, verifyStoredSpace, proofFor, createAgent, authAgent, runCheckpoint,
  seedStory, attack, resetSandbox, getSpace, overview, loadChain, labelConcept, conceptGraph, repairSpace, formatRecall, EngramError,
} from "../src/index";
import { setup } from "./helpers";

describe("write path", () => {
  it("20 parallel remembers produce seq 0..19 with no gaps, and the chain verifies", async () => {
    const { ctx } = await setup();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      remember(ctx, { text: `Parallel fact number ${i} about topic ${i * 7919}`, subject: `topic:t${i}` })));
    expect(results.map((r) => r.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const r = await verifyStoredSpace(ctx.b, ctx.space);
    expect(r.findings).toEqual([]);
    expect(r.validThrough).toBe(19);
  });

  it("detects duplicates, supersessions and conflicts, and recalls with provenance", async () => {
    const { ctx, drain } = await setup();
    const a = await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    await remember(ctx, { text: "Ada prefers email over phone calls.", subject: "customer:ada", kind: "preference" });
    const dup = await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    expect(dup.status).toBe("duplicate");
    expect(dup.id).toBe(a.id);
    const basic = await remember(ctx, { text: "Ada downgraded from the Pro plan to Basic on 22 October.", subject: "customer:ada" });
    expect(basic.relations.find((r) => r.id === a.id)?.relation).toBe("supersedes");
    const pro = await remember(ctx, { text: "Ada's account is on the Pro plan.", subject: "customer:ada" });
    expect(pro.relations.find((r) => r.id === basic.id)?.relation).toBe("contradicts");
    await drain();

    const res = await recall(ctx, { query: "What plan is Ada on?", k: 5 });
    const ids = res.memories.map((m) => m.id);
    expect(ids).toContain(basic.id);
    expect(ids).not.toContain(a.id);
    expect(res.conflicts).toBe(2);
    expect(formatRecall(res)).toMatch(/conflicts with/);

    const withOld = await recall(ctx, { query: "What plan is Ada on?", includeSuperseded: true });
    expect(withOld.memories.find((m) => m.id === a.id)?.status).toBe("superseded");

    const report = await verifyStoredSpace(ctx.b, ctx.space);
    expect(report.findings).toEqual([]);
  });

  it("resolves a conflict with a link entry recorded in the chain", async () => {
    const { ctx } = await setup();
    const basic = await remember(ctx, { text: "Ada downgraded from the Pro plan to Basic on 22 October.", subject: "customer:ada" });
    const pro = await remember(ctx, { text: "Ada's account is on the Pro plan.", subject: "customer:ada" });
    expect(pro.relations[0]?.relation).toBe("contradicts");
    const res = await resolveConflict(ctx, { winnerId: basic.id, loserId: pro.id, action: "supersede", reason: "Confirmed by the customer" });
    expect(res.seq).toBe(2);
    const chain = await loadChain(ctx.b, ctx.space.key);
    expect(chain[1].metadata.d.status).toBe("superseded");
    expect(chain[0].metadata.d.contradictedBy).toEqual([]);
    expect(chain[2].metadata.op).toBe("link");
    expect((await verifyStoredSpace(ctx.b, ctx.space)).findings).toEqual([]);
  });

  it("forgets provably: content gone, receipt kept, chain still verifies, as-of shows the erasure", async () => {
    const { ctx } = await setup();
    const addr = await remember(ctx, { text: "Ada shared a delivery address: 14 Palm Close, Lekki.", subject: "customer:ada" });
    const mid = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const f = await forget(ctx, { id: addr.id, reason: "Customer asked to be forgotten" });
    expect(f.erased).toBe(true);
    const doc = (await ctx.b.vectors.get<any>("memories", addr.id))!;
    expect(doc.metadata.c).toEqual({ text: null, salt: null });
    expect(doc.metadata.text).toBeNull();
    expect(doc.embeddings![0]).toBe(1);
    expect((await verifyStoredSpace(ctx.b, ctx.space, "deep")).findings).toEqual([]);
    await expect(forget(ctx, { id: addr.id })).rejects.toThrow(EngramError);
    const t = await timeline(ctx, { subject: "customer:ada" });
    expect(t.entries.map((e) => e.op)).toEqual(["remember", "forget"]);
    const then = await recall(ctx, { query: "Where does Ada want the token delivered?", asOf: mid, subject: "customer:ada" });
    expect(then.memories[0]?.status).toBe("forgotten");
    expect(then.memories[0]?.note).toMatch(/erased/);
  });

  it("answers as of a past moment, with fast and authoritative modes agreeing", async () => {
    const { ctx } = await setup();
    await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" }, { createdAt: "2026-10-19T09:01:00.000Z" });
    await remember(ctx, { text: "Ada downgraded from the Pro plan to Basic on 22 October.", subject: "customer:ada" }, { createdAt: "2026-10-22T11:15:00.000Z" });
    for (const verify of [false, true]) {
      const tue = await recall(ctx, { query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00.000Z", verify });
      expect(tue.memories.map((m) => m.text)).toEqual(["Ada is on the Pro plan, billed monthly."]);
      const now = await recall(ctx, { query: "What plan is Ada on?", verify });
      expect(now.memories[0].text).toMatch(/Basic/);
    }
  });

  it("issues inclusion proofs against signed checkpoints", async () => {
    const { ctx, keys } = await setup();
    for (let i = 0; i < 5; i++) await remember(ctx, { text: `Fact ${i} about Northwind's roadmap item ${i}` });
    const run = await runCheckpoint(ctx.b, ctx.space, { privateKey: keys.privateKey });
    expect(run.created).toBe(true);
    const space = (await getSpace(ctx.b, ctx.space.key))!;
    const p = await proofFor(ctx.b, space, `m_${space.key}_000000000003`);
    expect(await verifyProofHex(p.leaf, p.index, Number(p.checkpoint.size), p.path, p.checkpoint.root)).toBe(true);
    expect((await runCheckpoint(ctx.b, space, { privateKey: keys.privateKey })).created).toBe(false);
  });

  it("authenticates agents by key and enforces scopes", async () => {
    const { ctx } = await setup();
    const { key, agent } = await createAgent(ctx.b, ctx.space, { name: "reader", description: "Read-only research agent", scopes: ["recall"] }, "test");
    const actx = await authAgent(ctx.b, `Bearer ${key}`);
    expect(actx.actor).toBe(agent.id);
    await expect(remember(actx, { text: "Should be rejected" })).rejects.toThrow(/scope/);
    await expect(authAgent(ctx.b, "Bearer eng_AAAA_" + "x".repeat(32))).rejects.toThrow(/Unknown/);
    expect((await recall(actx, { query: "anything" })).memories).toEqual([]);
  });

  it("clusters memories into concepts and builds a graph", async () => {
    const { ctx, drain } = await setup();
    for (const t of ["Apollo launch is in December.", "Apollo staging runs in Frankfurt.", "Apollo load test reached 40,000 events per second."]) {
      await remember(ctx, { text: t, subject: "project:apollo" });
      await drain();
    }
    const g = await conceptGraph(ctx);
    expect(g.nodes.length).toBeGreaterThan(0);
    const label = await labelConcept(ctx, g.nodes[0].id);
    expect(label?.label).toBeTruthy();
  });
});

describe("demo story and Tamper Lab", () => {
  it("seeds the demo story with the expected supersede, conflict and duplicate", async () => {
    const { ctx } = await setup();
    const res = await seedStory(ctx, { variant: "demo", background: 20 });
    expect(res.duplicates).toBe(1);
    expect(Object.keys(res.keys).sort()).toEqual(["billing-agent", "onboarding-agent", "support-agent"]);
    const space = (await getSpace(ctx.b, ctx.space.key))!;
    const o = await overview({ ...ctx, space });
    expect(o.stats.conflicts).toBe(1);
    expect(o.stats.superseded).toBe(1);
    const r = await verifyStoredSpace(ctx.b, space);
    expect(r.status).toBe("valid");
    expect(r.checkpointsValid).toBeGreaterThan(0);
    const support = await authAgent(ctx.b, res.keys["support-agent"]);
    const ans = await recall(support, { query: "Ada emailed. What plan is she on and how should I reply?", k: 5 });
    expect(ans.memories.some((m) => /Basic/.test(m.text ?? ""))).toBe(true);
    const tue = await recall(support, { query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00.000Z", subject: "customer:ada" });
    expect(tue.memories.find((m) => /plan/.test(m.text ?? ""))?.text).toMatch(/Pro plan, billed monthly/);
  });

  it("every attack is caught by its expected layer; reset restores a valid chain", async () => {
    const { ctx } = await setup({ sandbox: true });
    await resetSandbox(ctx, "test");
    for (const a of ATTACKS) {
      const space = (await getSpace(ctx.b, ctx.space.key))!;
      const sctx = { ...ctx, space };
      const before = await verifyStoredSpace(ctx.b, space);
      expect(before.status, `sandbox valid before ${a.id}`).toBe("valid");
      await attack(sctx, a.id);
      const after = await verifyStoredSpace(ctx.b, space, a.deepOnly ? "deep" : "standard");
      const rules = new Set(after.findings.map((f) => f.rule));
      for (const rule of a.expectRules.filter((r) => r !== "checkpoint" && r !== "time")) expect(rules.has(rule as never), `${a.id} -> ${rule}`).toBe(true);
      expect(after.status).not.toBe("valid");
      await resetSandbox(sctx, "test");
    }
  }, 120_000);

  it("refuses lab actions outside sandboxes", async () => {
    const { ctx } = await setup();
    await expect(attack(ctx, "edit-text")).rejects.toThrow(/sandbox/);
  });

  it("repair rebuilds derived state from the chain", async () => {
    const { ctx } = await setup({ sandbox: true });
    await resetSandbox(ctx, "test");
    const space = (await getSpace(ctx.b, ctx.space.key))!;
    await attack({ ...ctx, space }, "hide-supersession");
    expect((await verifyStoredSpace(ctx.b, space)).status).toBe("warning");
    const fixed = await repairSpace({ ...ctx, space });
    expect(fixed.fixed).toBeGreaterThan(0);
    expect((await verifyStoredSpace(ctx.b, space)).status).toBe("valid");
    expect(seqOf("m_aaaaaaaa_000000000007")).toBe(7);
  });
});
