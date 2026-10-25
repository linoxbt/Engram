/** Helpers the API routes use: query parameters, quotas and throttles. */
import { describe, expect, it } from "vitest";
import { assertSpaceQuota, createSpace, exportSpace, exportSpaceStream, getSpace, loadChain, parseEntryCursor, parseLimit, parseSeqParam, remember, toErrorBody, verifyThrottled, type Backend } from "../src/index";
import { setup } from "./helpers";

const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return toErrorBody(e).status; } };
const statusAsync = async (p: Promise<unknown>) => p.then(() => 200, (e) => toErrorBody(e).status);

describe("quotas", () => {
  it("caps owned spaces at 10 and sandboxes at 3 per person", async () => {
    const { b, user } = await setup(); // owns one space already
    const other = await b.auth.signUp("quota-other@example.com", "password123", "Other");
    const theirs = await createSpace(b, { name: "Theirs", ownerId: other.id });
    await b.teams.addMember(theirs.teamId, user.id, ["member"]); // membership elsewhere does not count
    for (let i = 0; i < 3; i++) {
      await assertSpaceQuota(b, user.id, true);
      await createSpace(b, { name: `Lab ${i}`, ownerId: user.id, sandbox: true });
    }
    await expect(assertSpaceQuota(b, user.id, true)).rejects.toThrow(/at most 3 sandboxes/);
    for (let i = 0; i < 6; i++) {
      await assertSpaceQuota(b, user.id, false);
      await createSpace(b, { name: `Space ${i}`, ownerId: user.id });
    }
    const err = await assertSpaceQuota(b, user.id, false).catch((e) => e);
    expect(toErrorBody(err)).toMatchObject({ status: 403, body: { error: { message: expect.stringMatching(/at most 10 spaces/) } } });
  });
});

describe("agent verification budget", () => {
  it("verifies a space at most once a minute: later calls reuse the result, deep after standard is a 429", async () => {
    const { b, space, ctx, drain } = await setup();
    await remember(ctx, { text: "Invoices go out on the first of the month.", kind: "fact" });
    await drain();
    let writes = 0;
    const counting = { ...b, files: Object.assign(Object.create(b.files), { put: async (...a: Parameters<Backend["files"]["put"]>) => { if (a[1].startsWith("st_") && !a[1].endsWith("_000000000000")) writes++; return b.files.put(...a); } }) as Backend["files"] };
    const vctx = { ...ctx, b: counting, space: (await getSpace(b, space.key))! };
    const t = Date.now();
    const first = await verifyThrottled(vctx, {}, t);
    const again = await verifyThrottled(vctx, { mode: "standard" }, t + 30_000);
    expect(again).toEqual(first);
    expect(writes).toBe(1);
    const deep = await verifyThrottled(vctx, { mode: "deep" }, t + 40_000).catch((e) => e);
    expect(toErrorBody(deep).status).toBe(429);
    const later = await verifyThrottled(vctx, { mode: "deep" }, t + 61_000);
    expect(later.status).toBe("valid");
    expect(writes).toBe(2);
    // A standard request inside the deep run's window reuses it.
    expect(await verifyThrottled(vctx, {}, t + 62_000)).toEqual(later);
    expect(writes).toBe(2);
  });
});

describe("export", () => {
  it("streams the space page by page as one valid JSON document", async () => {
    const { b, space, ctx } = await setup();
    await remember(ctx, { text: "Payroll runs on Fridays.", kind: "fact" });
    for (let i = 1; i <= 450; i++) {
      const id = `m_${space.key}_${String(i).padStart(12, "0")}`;
      await b.vectors.create("memories", id, { embeddings: [1], metadata: { space: space.key, seq: String(i).padStart(12, "0"), n: String(i) } });
    }
    let queries = 0;
    const counting = { ...b, vectors: Object.assign(Object.create(b.vectors), { query: (...a: Parameters<Backend["vectors"]["query"]>) => { queries++; return b.vectors.query(...a); } }) as Backend["vectors"] };
    const { stream, exportedAt } = exportSpaceStream({ ...ctx, b: counting });
    const reader = stream.getReader();
    const dec = new TextDecoder();
    const first = await reader.read();
    let text = dec.decode(first.value);
    expect(text).toContain('"entries": [');
    expect(queries).toBeLessThanOrEqual(1); // pages are read as the client reads, not all up front
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += dec.decode(r.value);
    const doc = JSON.parse(text);
    expect(queries).toBe(3); // 451 entries in pages of 200
    expect(doc).toMatchObject({ format: "engram-export-v1", exportedAt, space: space.key });
    expect(doc.entries).toHaveLength(451);
    expect(doc.entries.map((e: { id: string }) => e.id)).toEqual((await loadChain(b, space.key)).map((e) => e.$id));
    expect(doc.settings).not.toHaveProperty("people");

    const empty = await setup();
    expect((await exportSpace(empty.ctx)).entries).toEqual([]);
  });
});

describe("query parameters", () => {
  it("limit: whole numbers are clamped, anything else is a 400", () => {
    expect(parseLimit(null, 30, 100)).toBe(30);
    expect(parseLimit("", 30, 100)).toBe(30);
    expect(parseLimit("5", 30, 100)).toBe(5);
    expect(parseLimit("0", 30, 100)).toBe(1);
    expect(parseLimit("100000", 30, 100)).toBe(100);
    for (const bad of ["abc", "-1", "1.5", "1e3", "NaN", "Infinity", "12abc"]) expect(status(() => parseLimit(bad, 30, 100))).toBe(400);
  });

  it("after: a non-negative whole number or a 400", () => {
    expect(parseSeqParam("after", null)).toBeUndefined();
    expect(parseSeqParam("after", "12")).toBe(12);
    expect(status(() => parseSeqParam("after", "x"))).toBe(400);
  });

  it("cursor: must be an existing entry of this space", async () => {
    const { b, space, ctx } = await setup();
    const r = await remember(ctx, { text: "The office opens at nine.", kind: "fact" });
    expect(await parseEntryCursor(b, space.key, r.id)).toBe(r.id);
    expect(await parseEntryCursor(b, space.key, null)).toBeUndefined();
    expect(await statusAsync(parseEntryCursor(b, space.key, "garbage"))).toBe(400);
    expect(await statusAsync(parseEntryCursor(b, space.key, `m_${space.key}_000000000999`))).toBe(400);
    expect(await statusAsync(parseEntryCursor(b, space.key, `m_zzzzzzzz_000000000000`))).toBe(400);
  });
});
