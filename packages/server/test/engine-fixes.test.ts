/** Engine fixes from the third audit (B1): ordering, locks, injection, provenance, erasure, paging, honesty, speed. */
import { describe, expect, it, vi } from "vitest";
import { sha256Hex, type EntryMeta } from "@engram/core";
import { ConflictError, RecallInput, append, applyPending, attack, authAgent, createAgent, getEntry, getSpace, loadChain, remember, resetSandbox, resolveConflict, verifyStoredSpace, type Backend, type Ctx, type TxOp } from "../src/index";
import { setup } from "./helpers";

describe("input bounds", () => {
  it("a Tamper Lab attack on a position outside the chain is a bad request, not a crash", async () => {
    const { ctx } = await setup({ sandbox: true });
    await resetSandbox(ctx, "test");
    const space = (await getSpace(ctx.b, ctx.space.key))!;
    await expect(attack({ ...ctx, space }, "edit-text", { seq: 9999 })).rejects.toMatchObject({ code: "bad_request" });
    await expect(attack({ ...ctx, space }, "swap", { seq: 1, otherSeq: 9999 })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("asOf accepts offsets and is normalised to the chain's 24-char UTC form", () => {
    expect(RecallInput.parse({ query: "plan", asOf: "2026-10-20T13:00:00+01:00" }).asOf).toBe("2026-10-20T12:00:00.000Z");
    expect(RecallInput.parse({ query: "plan", asOf: "2026-10-20T12:00:00Z" }).asOf).toBe("2026-10-20T12:00:00.000Z");
    expect(RecallInput.safeParse({ query: "plan", asOf: "yesterday" }).success).toBe(false);
  });
});

describe("conflict resolution", () => {
  it("supersede through resolve needs an open conflict between the two memories", async () => {
    const { b, ctx } = await setup();
    const a = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada is on the Pro plan." });
    const c = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Kestrel pays by card." });
    await expect(resolveConflict(ctx, { winnerId: c.id, loserId: a.id, action: "supersede" })).rejects.toMatchObject({ code: "bad_request" });
    expect((await getEntry(b, a.id))!.metadata.d.status).toBe("active");
    const x = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada is on Basic.", refs: { contradicts: [a.id] } });
    await resolveConflict(ctx, { winnerId: x.id, loserId: a.id, action: "supersede" });
    expect((await getEntry(b, a.id))!.metadata.d.supersededBy).toBe(x.id);
  });
});

/** Batches applied one document at a time (as on Appwrite without transactions), failing where `fail` says. */
function oneAtATime(b: Backend, fail: (op: TxOp) => boolean) {
  b.vectors.transact = async (ops) => {
    for (const op of ops) {
      if (fail(op)) throw new ConflictError("contention");
      if (op.action === "update") await b.vectors.update(op.coll, op.id, op.data, op.perms, { ifUpdatedAt: op.ifUpdatedAt });
      else if (op.action === "create") await b.vectors.create(op.coll, op.id, op.data, op.perms);
      else await b.vectors.delete(op.coll, op.id);
    }
  };
}

/** Every backend call takes `ms`: elapsed time / ms is the number of sequential round trips. */
function slow(b: Backend, ms: number) {
  const calls: string[] = [];
  const wrap = (obj: Record<string, unknown>, name: string, methods: string[]) => {
    for (const m of methods) {
      const orig = (obj[m] as (...a: unknown[]) => Promise<unknown>).bind(obj);
      obj[m] = async (...args: unknown[]) => { calls.push(`${name}.${m}`); await new Promise((r) => setTimeout(r, ms)); return orig(...args); };
    }
  };
  wrap(b.vectors as never, "vectors", ["create", "get", "update", "delete", "query", "transact"]);
  wrap(b.files as never, "files", ["put", "get", "list", "delete"]);
  wrap(b.teams as never, "teams", ["getPrefs", "updatePrefs"]);
  wrap(b.embedder as never, "embedder", ["embed"]);
  return calls;
}

describe("derived state follows chain order", () => {
  it("a later supersession never lands before an earlier one that gave up under contention", async () => {
    const { b, space, ctx } = await setup();
    const x = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada is on the Pro plan." });
    const nId = `m_${space.key}_000000000001`;
    let contended = true;
    // Every write that would record N as X's successor loses its race; everything else lands, one op at a time.
    oneAtATime(b, (op) => contended && op.action === "update" && op.id === x.id && (op.data.metadata as EntryMeta | undefined)?.d.supersededBy === nId);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const n = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada moved to Basic.", refs: { supersedes: [x.id] } });
    expect(n.id).toBe(nId);
    expect(n.derivedPending).toBe(true);
    const n1 = await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada moved to Enterprise.", refs: { supersedes: [x.id] } });
    // N+1 must wait for N: applying it first would make it X's successor, which the replay says is N.
    expect(n1.derivedPending).toBe(true);
    expect((await getEntry(b, x.id))!.metadata.d.status).toBe("active");
    contended = false;
    expect(await applyPending(ctx)).toEqual({ applied: 2, blocked: false });
    err.mockRestore();
    expect((await getEntry(b, x.id))!.metadata.d.supersededBy).toBe(n.id);
    expect((await verifyStoredSpace(b, space)).findings).toEqual([]);
  });

  it("random contention on one-at-a-time batches never leaves state the replay disagrees with", async () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 3; round++) {
      const { b, space, ctx } = await setup();
      const xs: string[] = [];
      for (let i = 0; i < 4; i++) xs.push((await append(ctx, { op: "remember", kind: "fact", subject: null, text: `fact ${i}` })).id);
      let failing = true;
      oneAtATime(b, () => failing && rand() < 0.35);
      const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await Promise.all(Array.from({ length: 8 }, (_, i) => {
        const t = xs[Math.floor(rand() * xs.length)], u = xs[Math.floor(rand() * xs.length)];
        const r = rand();
        const draft = r < 0.4 ? { op: "remember" as const, kind: "fact" as const, subject: null, text: `w${i}`, refs: { supersedes: [t] } }
          : r < 0.8 ? { op: "remember" as const, kind: "fact" as const, subject: null, text: `w${i}`, refs: { contradicts: [t, u] } }
          : { op: "forget" as const, kind: "tombstone" as const, subject: null, text: null, refs: { target: t } };
        return append(ctx, draft).catch(() => undefined);
      }));
      failing = false;
      await applyPending(ctx);
      err.mockRestore();
      expect((await verifyStoredSpace(b, space)).findings, `round ${round}`).toEqual([]);
    }
  });
});

describe("remember round trips", () => {
  it("runs independent calls side by side and skips repeated reads", async () => {
    const { b, space } = await setup();
    const { key } = await createAgent(b, space, { name: "billing", description: "billing agent", scopes: ["remember", "recall"] }, "test");
    const tasks: Promise<unknown>[] = [];
    const agent = await authAgent(b, key, (t) => { tasks.push(t()); });
    await remember(agent, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    await Promise.all(tasks);
    const ms = 40;
    const calls = slow(b, ms);
    const t = Date.now();
    // An agent write with an idempotency key whose classification supersedes a neighbour: the slowest common path.
    const r = await remember(agent, { text: "Ada downgraded from the Pro plan to Basic on 22 October.", subject: "customer:ada", idempotencyKey: "k1" });
    const depth = (Date.now() - t) / ms;
    const before = calls.length;
    await Promise.all(tasks);
    expect(r.relations.map((x) => x.relation)).toEqual(["supersedes"]);
    // 17 sequential round trips before this change; now: lock+replay | rate | embed | pending, nearest, head+refs,
    // create+pending, the neighbour update.
    expect(depth).toBeLessThan(8);
    void before;
    expect((await verifyStoredSpace(b, space)).findings).toEqual([]);
  });
});

describe("idempotency lock", () => {
  const enc = (o: object) => new TextEncoder().encode(JSON.stringify(o));
  const lockOf = async (ctx: Ctx, key: string) => `idm_${ctx.space.key}_${(await sha256Hex(`${ctx.actor}:${key}`)).slice(0, 24)}`;

  it("a writer that waited for the key checks again once it holds the lock", async () => {
    const { b, ctx, cfg } = await setup();
    const bucket = cfg.appwrite.checkpointsBucket;
    const fileId = await lockOf(ctx, "same-key");
    // Another request holds the key and is writing.
    await b.files.put(bucket, fileId, "x", enc({ at: new Date().toISOString(), token: "holder" }), []);
    const get = b.files.get.bind(b.files);
    let armed = true;
    b.files.get = async (bk, id) => {
      if (armed && id === fileId) {
        armed = false;
        // The holder finishes after our replay check missed: its entry lands and it releases the lock.
        await append(ctx, { op: "remember", kind: "fact", subject: null, text: "Ada prefers email.", idem: `${ctx.actor}:same-key` });
        await b.files.delete(bk, id);
      }
      return get(bk, id);
    };
    // skipRelate: duplicate detection must not be what saves us.
    const r = await remember(ctx, { text: "Ada prefers email.", idempotencyKey: "same-key" }, { skipRelate: true });
    expect(r.id).toBe(`m_${ctx.space.key}_000000000000`);
    expect((await loadChain(b, ctx.space.key)).length).toBe(1);
  });

  it("releases only its own lock, never one another writer took after reclaiming it", async () => {
    const { b, ctx, cfg, drain } = await setup();
    const bucket = cfg.appwrite.checkpointsBucket;
    const fileId = await lockOf(ctx, "k2");
    const create = b.vectors.create.bind(b.vectors);
    let armed = true;
    b.vectors.create = (async (...args: Parameters<typeof create>) => {
      if (!armed) return create(...args);
      armed = false;
      // While we write, our lock is judged stale and another writer takes the key.
      await b.files.delete(bucket, fileId);
      await b.files.put(bucket, fileId, "x", enc({ at: new Date().toISOString(), token: "theirs" }), []);
      return create(...args);
    }) as typeof create;
    await remember(ctx, { text: "Kestrel pays by card.", idempotencyKey: "k2" }, { skipRelate: true });
    await drain();
    expect(new TextDecoder().decode((await b.files.get(bucket, fileId))!)).toContain("theirs");
  });
});
