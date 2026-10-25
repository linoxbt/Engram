/** Pure helpers from apps/web (no Next.js runtime needed): redirects, client keys, rate limits, names. */
import { describe, expect, it } from "vitest";
import { safeNextFor } from "../../../apps/web/lib/client/safe-next";
import { errorLine, requestIdFor } from "../../../apps/web/lib/server/log";
import { clientKey, WindowCounter } from "../../../apps/web/lib/server/limits";
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

describe("rate-limit keys and counters", () => {
  it("groups IPv6 by /64 and normalises address forms", () => {
    expect(clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("[2001:db8:1:2::99]:443")).toBe("2001:db8:1:2::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(clientKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey("203.0.113.9:5555")).toBe("203.0.113.9");
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
    for (const bad of [null, undefined, "", "unknown", "not an ip", "999.1.1.1", "1:2:3", "1::2::3"]) expect(clientKey(bad), String(bad)).toBe("unknown");
  });

  it("counts addresses without a known IP in one shared bucket instead of letting them through", () => {
    const c = new WindowCounter();
    const hits = Array.from({ length: 5 }, () => c.hit("login:" + clientKey(undefined), 3, 60_000));
    expect(hits.filter((h) => h !== null)).toHaveLength(2);
  });

  it("evicts the least recently used keys instead of clearing every counter when full", () => {
    const c = new WindowCounter(100);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) c.hit("victim", 3, 60_000, now);
    for (let i = 0; i < 500; i++) {
      c.hit(`flood${i}`, 3, 60_000, now);
      if (i % 50 === 0) c.hit("victim", 1000, 60_000, now); // still in use, so it stays
    }
    expect(c.size).toBeLessThanOrEqual(100);
    expect(c.hit("victim", 3, 60_000, now)).not.toBeNull();
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
