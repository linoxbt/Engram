/** Errors must be recognised even when thrown by a second copy of the module (bundlers can duplicate it). */
import { describe, expect, it } from "vitest";
import { isConflict, isEngramError, toErrorBody } from "../src/index";

function foreign(name: string, fields: Record<string, unknown> = {}) {
  class Copy extends Error {}
  return Object.assign(Object.defineProperty(new Copy("m"), "name", { value: name }), fields);
}

describe("errors from another module copy", () => {
  it("map to their own status, not 500", () => {
    const e = foreign("EngramError", { code: "unauthorized", status: 401, message: "Invalid email or password." });
    expect(isEngramError(e)).toBe(true);
    expect(toErrorBody(e)).toEqual({ status: 401, body: { error: { code: "unauthorized", message: "Invalid email or password.", details: undefined } } });
  });
  it("still count as the chain's conflict signal", () => {
    expect(isConflict(foreign("ConflictError"))).toBe(true);
    expect(isConflict(new Error("boom"))).toBe(false);
  });
});
