/** Pure helpers from apps/web (no Next.js runtime needed): redirects, client keys, rate limits, names. */
import { describe, expect, it } from "vitest";
import { safeNextFor } from "../../../apps/web/lib/client/safe-next";

const ORIGIN = "https://engram.example";

describe("safeNext", () => {
  it("never returns a path the router would treat as another site", () => {
    for (const bad of ["/.//evil.com", "/a/..//evil.com", "/%2e//evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/%2e%2e//evil.com", "/./\\evil.com"]) {
      const out = safeNextFor(bad, ORIGIN);
      expect(out, bad).toBe("/app");
      expect(out.startsWith("//") || out.startsWith("/\\")).toBe(false);
    }
  });

  it("keeps ordinary same-origin paths, queries and fragments", () => {
    expect(safeNextFor("/app/abcd1234/chain", ORIGIN)).toBe("/app/abcd1234/chain");
    expect(safeNextFor("/invite?token=abc.def#x", ORIGIN)).toBe("/invite?token=abc.def#x");
    expect(safeNextFor("/a/../app", ORIGIN)).toBe("/app");
    expect(safeNextFor(null, ORIGIN, "/fallback")).toBe("/fallback");
  });
});
