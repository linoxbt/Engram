/** Pure helpers from apps/web (no Next.js runtime needed): redirects, client keys, rate limits, names. */
import { describe, expect, it } from "vitest";
import { safeNextFor } from "../../../apps/web/lib/client/safe-next";
import { errorLine, requestIdFor } from "../../../apps/web/lib/server/log";
import { EngramError, errorLogFields } from "../src/index";

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

describe("request IDs and error lines", () => {
  it("echoes a safe upstream ID and replaces anything else", () => {
    expect(requestIdFor(new Headers({ "x-request-id": "abc-123-def" }))).toBe("abc-123-def");
    expect(requestIdFor(new Headers({ "x-nf-request-id": "01JNETLIFY0000" }))).toBe("01JNETLIFY0000");
    const fresh = requestIdFor(new Headers({ "x-request-id": "bad id with spaces" }));
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("logs one JSON line with the contract's fields, including mapped and unexpected errors", () => {
    const line = JSON.parse(errorLine({ reqId: "r1", route: "/api/x", status: 503, code: "unavailable", message: "down" }));
    expect(line).toEqual({ level: "error", reqId: "r1", route: "/api/x", status: 503, code: "unavailable", message: "down" });
    expect(errorLogFields(new EngramError("unavailable", "Appwrite is down"))).toEqual({ status: 503, code: "unavailable", message: "Appwrite is down" });
    expect(errorLogFields(new TypeError("x is undefined"))).toEqual({ status: 500, code: "internal", message: "TypeError: x is undefined" });
    expect(new EngramError("terms_required", "t").status).toBe(403);
    expect(new EngramError("read_only", "r").status).toBe(403);
  });
});
