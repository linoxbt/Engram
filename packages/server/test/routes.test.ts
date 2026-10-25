/** Helpers the API routes use: query parameters, quotas and throttles. */
import { describe, expect, it } from "vitest";
import { parseEntryCursor, parseLimit, parseSeqParam, remember, toErrorBody } from "../src/index";
import { setup } from "./helpers";

const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return toErrorBody(e).status; } };
const statusAsync = async (p: Promise<unknown>) => p.then(() => 200, (e) => toErrorBody(e).status);

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
