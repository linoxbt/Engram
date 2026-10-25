/** Regression tests for the production-readiness audit: one per finding that code can reproduce. */
import { afterEach, describe, expect, it } from "vitest";
import { verifySpace, type EntryMeta } from "@engram/core";
import {
  append, applyPending, authAgent, bumpAgentStats, createAgent, deleteSpace, forget, getConfig, getEntry, getSpace, heuristicRelate,
  loadChain, loadCheckpoints, recall, remember, resetConfig, revokeAgent, runCheckpoint, seedStory, updateSettings, verifyStoredSpace, type ConceptMeta,
} from "../src/index";
import { setup } from "./helpers";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; resetConfig(); });

describe("configuration", () => {
  it("refuses to fall back to the local backend in production", () => {
    process.env = { ...ENV, NODE_ENV: "production", APPWRITE_ENDPOINT: "", APPWRITE_PROJECT_ID: "", APPWRITE_API_KEY: "", ENGRAM_BACKEND: "" };
    resetConfig();
    const cfg = getConfig();
    expect(cfg.configError).toMatch(/APPWRITE_ENDPOINT/);
    expect(cfg.devLinks).toBe(false);
  });

  it("allows an explicit local demo, without email links unless asked", () => {
    process.env = { ...ENV, NODE_ENV: "production", ENGRAM_BACKEND: "local", ENGRAM_DEV_LINKS: "" };
    resetConfig();
    expect(getConfig()).toMatchObject({ backend: "local", configError: null, devLinks: false });
  });
});

describe("agent keys", () => {
  it("a stats bump racing a revoke never re-activates the key", async () => {
    const { b, space, ctx } = await setup();
    const { agent, key } = await createAgent(b, space, { name: "bot", description: "test agent", scopes: ["remember", "recall"] }, ctx.actor);
    await Promise.all([revokeAgent(b, space.key, agent.id), bumpAgentStats(b, agent.id, "writes"), bumpAgentStats(b, agent.id, "recalls")]);
    await expect(authAgent(b, key)).rejects.toThrow(/revoked/);
  });

  it("deleting a space deletes its agents, so a reused key cannot get in", async () => {
    const { b, space, ctx } = await setup();
    const { key } = await createAgent(b, space, { name: "bot", description: "test agent", scopes: ["remember"] }, ctx.actor);
    await deleteSpace(b, space.key);
    await expect(authAgent(b, key)).rejects.toThrow(/Unknown agent key/);
  });
});

describe("erasure", () => {
  it("forget scrubs concept summaries and recall logs", async () => {
    const { b, ctx, drain } = await setup();
    const m = await remember(ctx, { text: "Ada's SSN is 123-45-6789 and she lives at 1 Elm St", subject: "customer:ada" });
    await drain();
    await recall(ctx, { query: "What is Ada's SSN?" });
    await drain();
    await forget(ctx, { id: m.id, reason: "GDPR request" });
    await drain();
    const concepts = await b.vectors.query<ConceptMeta>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }], limit: 10, withVectors: false });
    expect(JSON.stringify(concepts.map((c) => c.metadata))).not.toMatch(/123-45-6789/);
    const logs = await b.vectors.query<{ query: string }>("recalls", { filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }], limit: 10, withVectors: false });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => !/SSN/.test(l.metadata.query))).toBe(true);
    expect((await verifyStoredSpace(b, ctx.space)).status).not.toBe("tampered");
  });

  it("forget also forgets summaries derived from the memory", async () => {
    const { b, ctx } = await setup();
    const a = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada's phone number is 555-0100" });
    const s = await append(ctx, { op: "reflect", kind: "summary", subject: null, text: "Ada can be reached at 555-0100", refs: { derivedFrom: [a.id] } });
    await forget(ctx, { id: a.id });
    expect((await getEntry(b, s.id))!.metadata.c.text).toBeNull();
  });
});

describe("chain consistency", () => {
  it("an entry's own conflict is dropped when its partner was retired before its update landed", async () => {
    const { b, space, ctx } = await setup();
    const x = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "X fact" });
    const query = b.vectors.query.bind(b.vectors);
    const transact = b.vectors.transact.bind(b.vectors);
    let armed = true;
    // Writer A lands between C's helping pass and C's head read, and its neighbour update fails.
    b.vectors.query = (async (coll: never, spec: { filters?: { path: string }[] }) => {
      const res = await query(coll, spec as never);
      if (armed && spec.filters?.some((f) => f.path === "metadata.applied")) {
        armed = false;
        b.vectors.transact = async () => { throw new Error("instance died"); };
        await append(ctx, { op: "remember", kind: "fact", subject: null, text: "A contradicts X", refs: { contradicts: [x.id] } });
        b.vectors.transact = transact;
      }
      return res;
    }) as typeof b.vectors.query;
    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "C supersedes X", refs: { supersedes: [x.id] } });
    b.vectors.query = query;
    await applyPending(ctx);
    const a = await getEntry(b, `m_${space.key}_000000000001`);
    expect(a!.metadata.d.contradictedBy).toEqual([]);
    expect(a!.metadata.conflict).toBe("false");
    expect((await verifyStoredSpace(b, space)).findings).toEqual([]);
  });

  it("concurrent retries with one idempotency key write once", async () => {
    const { ctx } = await setup();
    const [a, b] = await Promise.all([1, 2].map(() => remember(ctx, { text: "Ada prefers email.", idempotencyKey: "same-key" })));
    expect(a.id).toBe(b.id);
    expect((await loadChain(ctx.b, ctx.space.key)).length).toBe(1);
  });

  it("concurrent settings updates keep both changes", async () => {
    const { b, space } = await setup();
    await Promise.all([updateSettings(b, space.key, { retentionDays: 30 }), updateSettings(b, space.key, { checkpointEvery: 7 })]);
    expect((await getSpace(b, space.key))!.settings).toMatchObject({ retentionDays: 30, checkpointEvery: 7 });
  });
});

describe("checkpoint signer", () => {
  it("refuses to sign a chain that was rewritten after the last checkpoint", async () => {
    const { b, ctx, keys } = await setup();
    for (let i = 0; i < 3; i++) await append(ctx, { op: "remember", kind: "fact", subject: null, text: `fact ${i}` });
    expect((await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey })).created).toBe(true);
    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "fact 3" });
    const e = (await getEntry(b, `m_${ctx.space.key}_000000000003`))!;
    await b.vectors.update<EntryMeta>("memories", e.$id, { metadata: { ...e.metadata, h: { ...e.metadata.h, subject: "forged" } } });
    const run = await runCheckpoint(b, (await getSpace(b, ctx.space.key))!, { privateKey: keys.privateKey });
    expect(run.created).toBe(false);
    expect(run.reason).toMatch(/refusing to sign/);
    expect(await loadCheckpoints(b, ctx.space.key)).toHaveLength(1);
    expect((await getSpace(b, ctx.space.key))!.settings.integrity?.status).toBe("tampered");
  });
});

describe("verifier inputs", () => {
  it("reports a hostile checkpoint size instead of hashing a trillion leaves", async () => {
    const { b, ctx, keys } = await setup();
    await append(ctx, { op: "remember", kind: "fact", subject: null, text: "fact" });
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    const [cp] = await loadCheckpoints(b, ctx.space.key);
    const entries = await loadChain(b, ctx.space.key);
    const r = await verifySpace({ space: ctx.space.key, entries, checkpoints: [{ ...cp, size: "1e12" }], publicKeyHex: keys.publicKey });
    expect(r.status).toBe("tampered");
    expect(r.findings[0].message).toMatch(/malformed/);
  });

  it("does not show green when signatures were not checked, and catches rollback", async () => {
    const { b, ctx, keys } = await setup();
    for (let i = 0; i < 4; i++) await append(ctx, { op: "remember", kind: "fact", subject: null, text: `fact ${i}` });
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    const entries = await loadChain(b, ctx.space.key);
    const checkpoints = await loadCheckpoints(b, ctx.space.key);
    expect((await verifySpace({ space: ctx.space.key, entries, checkpoints })).status).toBe("warning");
    const seen = { size: 4, root: checkpoints[0].root };
    expect((await verifySpace({ space: ctx.space.key, entries, checkpoints, publicKeyHex: keys.publicKey, trusted: seen })).status).toBe("valid");
    const rolled = await verifySpace({ space: ctx.space.key, entries: entries.slice(0, 2), checkpoints: [], publicKeyHex: keys.publicKey, trusted: seen });
    expect(rolled.findings.some((f) => f.rule === "rollback")).toBe(true);
  });
});

describe("rule-based classifier", () => {
  const n = (text: string) => ({ id: "m_x_000000000001", text, createdAt: "2026-10-01T00:00:00.000Z", agent: "a", agentName: "a", subject: null, kind: "fact", distance: 0.2 });
  const m = (text: string) => ({ text, kind: "fact", subject: null, createdAt: "2026-10-02T00:00:00.000Z", agentName: "b" });
  const rel = (a: string, b: string) => heuristicRelate(m(a), [n(b)])[0].relation;

  it("does not retire true facts on generic words", () => {
    expect(rel("Ada asked now whether the Pro plan includes SSO.", "Ada is on the Pro plan.")).not.toBe("supersedes");
    expect(rel("Bob, Ada's manager, left a voicemail.", "Ada's manager is Bob.")).not.toBe("supersedes");
    expect(rel("The Pro plan is what Ada uses.", "Ada is on the Pro plan.")).not.toBe("contradicts");
  });

  it("still sees real changes and disagreements", () => {
    expect(rel("Ada downgraded from the Pro plan to Basic on 22 October.", "Ada is on the Pro plan, billed monthly.")).toBe("supersedes");
    expect(rel("Ada's account is on the Pro plan.", "Ada downgraded from the Pro plan to Basic on 22 October.")).toBe("contradicts");
  });
});

describe("sign-in lockout", () => {
  it("locks an account after repeated failures, and a reset is the way out", async () => {
    const { b } = await setup();
    await b.auth.signUp("lock@example.com", "password123", "Lock");
    for (let i = 0; i < 8; i++) await expect(b.auth.signIn("lock@example.com", "wrong-password")).rejects.toThrow(/Invalid/);
    await expect(b.auth.signIn("lock@example.com", "password123")).rejects.toThrow(/Too many failed sign-ins/);
  });
});

describe("resumable seeding", () => {
  it("a story written in slices matches one written in one go", async () => {
    const whole = await setup({ sandbox: true });
    const all = await seedStory(whole.ctx, { variant: "sandbox" });
    expect(all.done).toBe(true);

    const sliced = await setup({ sandbox: true });
    let r = await seedStory(sliced.ctx, { variant: "sandbox", budgetMs: 1 });
    const keys = r.keys;
    let calls = 1;
    while (!r.done) { r = await seedStory(sliced.ctx, { variant: "sandbox", budgetMs: 1 }); calls++; }
    expect(calls).toBeGreaterThan(1);
    expect(Object.keys(keys).sort()).toEqual(Object.keys(all.keys).sort());
    const [a, b] = await Promise.all([loadChain(whole.b, whole.space.key), loadChain(sliced.b, sliced.space.key)]);
    expect(b.map((e) => [e.metadata.op, e.metadata.c.text, e.metadata.d.status])).toEqual(a.map((e) => [e.metadata.op, e.metadata.c.text, e.metadata.d.status]));
    expect((await getSpace(sliced.b, sliced.space.key))!.settings.seeding).toBeNull();
    expect((await verifyStoredSpace(sliced.b, sliced.space)).status).toBe("valid");
  });
});
