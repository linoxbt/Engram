/** Engine fixes from the third audit (B1): ordering, locks, injection, provenance, erasure, paging, honesty, speed. */
import { describe, expect, it } from "vitest";
import { RecallInput, append, attack, getEntry, getSpace, resetSandbox, resolveConflict } from "../src/index";
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
