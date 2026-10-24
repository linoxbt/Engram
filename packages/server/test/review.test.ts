/** Regression tests for defects found in review. Each failed before its fix. */
import { describe, expect, it } from "vitest";
import { generateKeyPair, verifySpace, runAttack, type EntryMeta } from "@engram/core";
import {
  remember, forget, patchDerived, loadChain, runCheckpoint, loadCheckpoints, getSpace, verifyStoredSpace, type VectorStore,
} from "../src/index";
import { setup } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Delay reads of one document so a concurrent writer can slip in between read and write. */
function slowReads(v: VectorStore, id: string, ms: number) {
  const get = v.get.bind(v);
  let armed = true;
  v.get = (async (coll: never, docId: string) => {
    const d = await get(coll, docId);
    if (armed && docId === id) { armed = false; await sleep(ms); }
    return d;
  }) as VectorStore["get"];
}

describe("review regressions", () => {
  it("#1 a concurrent derived write cannot resurrect forgotten content", async () => {
    const { ctx, b } = await setup();
    const a = await remember(ctx, { text: "Ada shared a delivery address: 14 Palm Close, Lekki.", subject: "customer:ada" });
    slowReads(b.vectors, a.id, 40);
    const bump = patchDerived(b, a.id, { access: "00000009" }); // reads, stalls, then writes
    await sleep(5);
    await forget(ctx, { id: a.id, reason: "erasure requested" });
    await bump;
    const doc = (await b.vectors.get<EntryMeta>("memories", a.id))!;
    expect(doc.metadata.c).toEqual({ text: null, salt: null });
    expect(doc.metadata.d.status).toBe("forgotten");
    expect((await verifyStoredSpace(b, ctx.space)).status).toBe("valid");
  });

  it("#2 overlapping checkpoint runs never fork the checkpoint chain", async () => {
    const { ctx, b, keys } = await setup();
    for (let i = 0; i < 3; i++) await remember(ctx, { text: `Northwind roadmap item number ${i} for review` });
    await runCheckpoint(b, ctx.space, { privateKey: keys.privateKey });
    for (let i = 3; i < 6; i++) await remember(ctx, { text: `Northwind roadmap item number ${i} for review` });
    // Run A stalls right before storing its file; meanwhile the chain grows and run B signs.
    const put = b.files.put.bind(b.files);
    let stall = true;
    b.files.put = async (...args) => { if (stall) { stall = false; await sleep(60); } return put(...args); };
    const runA = runCheckpoint(b, (await getSpace(b, ctx.space.key))!, { privateKey: keys.privateKey });
    await sleep(10);
    for (let i = 6; i < 8; i++) await remember(ctx, { text: `Northwind roadmap item number ${i} for review` });
    await runCheckpoint(b, (await getSpace(b, ctx.space.key))!, { privateKey: keys.privateKey });
    await runA;
    const cps = await loadCheckpoints(b, ctx.space.key);
    const prevs = cps.map((c) => c.prevCheckpoint);
    expect(new Set(prevs).size).toBe(prevs.length);
    expect((await verifyStoredSpace(b, ctx.space)).status).toBe("valid");
  });

  it("#3 removing derived state does not hide erasure or resurrection", async () => {
    const { ctx, b } = await setup();
    const a = await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    const entries = await loadChain(b, ctx.space.key);
    const m = entries[0].metadata as EntryMeta & { d: unknown };
    m.c = { text: null, salt: null }; m.text = null; (m as { d: unknown }).d = null;
    const r = await verifySpace({ space: ctx.space.key, entries });
    expect(r.status).toBe("tampered");
    expect(r.findings.some((f) => f.rule === "content")).toBe(true);
    expect(a.seq).toBe(0);
  });

  it("#4 a malformed header yields a finding, not a crash", async () => {
    const { ctx, b } = await setup();
    await remember(ctx, { text: "Ada prefers email over phone calls.", subject: "customer:ada" });
    await remember(ctx, { text: "Kestrel Foods paid invoice INV-204 on time.", subject: "customer:kestrel" });
    const entries = await loadChain(b, ctx.space.key);
    (entries[1].metadata.h as unknown as Record<string, unknown>).importance = 5;
    const r1 = await verifySpace({ space: ctx.space.key, entries });
    expect(r1.status).toBe("tampered");
    delete (entries[0].metadata.h as unknown as Record<string, unknown>).refs;
    entries[0].metadata.hash = "not-hex";
    const r2 = await verifySpace({ space: ctx.space.key, entries, checkpoints: [] });
    expect(r2.status).toBe("tampered");
    expect(r2.validThrough).toBe(-1);
  });

  it("#5 a writer applies earlier entries' effects before reading neighbour state", async () => {
    const { ctx, b } = await setup();
    const x = await remember(ctx, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    // Simulate a writer that created its entry but crashed before its neighbour updates.
    const tx = b.vectors.transact.bind(b.vectors);
    let fail = true;
    b.vectors.transact = async (ops) => { if (fail) { fail = false; throw new Error("instance died"); } return tx(ops); };
    await remember(ctx, { text: "Ada downgraded from the Pro plan to Basic on 22 October.", subject: "customer:ada" }).catch(() => undefined);
    // The next writer must see X as superseded, not record a conflict with it.
    const r = await remember(ctx, { text: "Ada's account is on the Pro plan.", subject: "customer:ada" });
    expect(r.relations.find((rel) => rel.id === x.id)).toBeUndefined();
    const report = await verifyStoredSpace(b, ctx.space);
    expect(report.findings).toEqual([]);
    void runAttack;
    void generateKeyPair;
  });
});
