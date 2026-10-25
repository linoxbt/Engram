/** Pure helpers from apps/web (no Next.js runtime needed): redirects, client keys, rate limits, names. */
import { describe, expect, it } from "vitest";
import { safeNextFor } from "../../../apps/web/lib/client/safe-next";
import { errorLine, requestIdFor } from "../../../apps/web/lib/server/log";
import { clientKey, WindowCounter } from "../../../apps/web/lib/server/limits";
import { cleanDisplayName } from "../../../apps/web/lib/server/names";
import { assertGuestAllowed, assertSpaceWriteAllowed, assertTermsAccepted, VIEWER_ROLE } from "../../../apps/web/lib/server/access";
import { EngramError, errorLogFields, isOwnerRole } from "../src/index";

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

describe("telemetry forwarding budget", () => {
  it("one address cannot spend the shared budget, and the shared cap still holds", () => {
    const c = new WindowCounter();
    const now = 5_000_000;
    const loud = Array.from({ length: 100 }, () => c.allow("hook", "1.1.1.1", 5, 60, 600_000, now)).filter(Boolean).length;
    expect(loud).toBe(5);
    // Others still get through after one client tried to flood.
    expect(c.allow("hook", "2.2.2.2", 5, 60, 600_000, now)).toBe(true);
    let total = 6;
    for (let i = 0; i < 200; i++) if (c.allow("hook", `10.0.${i}.1`, 5, 60, 600_000, now)) total++;
    expect(total).toBe(60);
  });
});

describe("display names", () => {
  it("are one plain line of bounded length", () => {
    expect(cleanDisplayName("Ada\nLovelace")).toBe("Ada Lovelace");
    expect(cleanDisplayName("  Ada \t\r\n  L.  ")).toBe("Ada L.");
    expect(cleanDisplayName("Eve\u202egnp.exe")).toBe("Eve gnp.exe");
    expect(cleanDisplayName("Zero\u200bWidth\u0007Bell")).toBe("Zero Width Bell");
    expect(cleanDisplayName("x".repeat(200))).toHaveLength(80);
    expect(cleanDisplayName("\n\t\u200b")).toBe("");
    expect(cleanDisplayName("José Müller-Łukasz")).toBe("José Müller-Łukasz");
  });
});

describe("terms gate", () => {
  const none = { termsAcceptedAt: null };
  it("refuses every signed-in call until the Terms are accepted, except accepting them or deleting the account", () => {
    expect(() => assertTermsAccepted(none, "GET", "/api/app/spaces")).toThrow(expect.objectContaining({ code: "terms_required", status: 403 }));
    expect(() => assertTermsAccepted(none, "POST", "/api/app/spaces/abcd1234/memories")).toThrow(/Terms/);
    expect(() => assertTermsAccepted(none, "GET", "/api/auth/jwt")).toThrow(/Terms/);
    expect(() => assertTermsAccepted(none, "PATCH", "/api/auth/me")).toThrow(/Terms/);
    expect(() => assertTermsAccepted(none, null, null)).toThrow(/Terms/);
    expect(() => assertTermsAccepted(none, "POST", "/api/auth/terms")).not.toThrow();
    expect(() => assertTermsAccepted(none, "DELETE", "/api/auth/me")).not.toThrow();
    expect(() => assertTermsAccepted({ termsAcceptedAt: "2026-10-25T00:00:00.000Z" }, "POST", "/api/app/spaces")).not.toThrow();
  });
});

describe("read-only viewers and guests", () => {
  const sp = "/api/app/spaces/abcd1234";
  it("viewers may read and run the read-only POSTs, nothing else", () => {
    const viewer = [VIEWER_ROLE];
    for (const [m, r] of [["GET", `${sp}/memories`], ["GET", sp], ["HEAD", `${sp}/chain`], ["POST", `${sp}/recall`], ["POST", `${sp}/verify`], ["GET", `${sp}/memories/m_abcd1234_000000000001/proof`], ["POST", `${sp}/memories/m_abcd1234_000000000001/proof`]] as const) {
      expect(() => assertSpaceWriteAllowed(viewer, m, r), `${m} ${r}`).not.toThrow();
    }
    for (const [m, r] of [["POST", `${sp}/memories`], ["POST", `${sp}/agents`], ["PATCH", `${sp}/settings`], ["DELETE", sp], ["POST", `${sp}/conflicts`], ["POST", `${sp}/lab`], ["POST", `${sp}/seed`], ["POST", `${sp}/memories/m_x/forget`], ["POST", `${sp}/recall/extra`], ["POST", `${sp}/members`], ["PUT", `${sp}/recall`]] as const) {
      expect(() => assertSpaceWriteAllowed(viewer, m, r), `${m} ${r}`).toThrow(expect.objectContaining({ code: "read_only", status: 403 }));
    }
  });

  it("members and owners are unaffected, and a viewer is never an owner", () => {
    expect(() => assertSpaceWriteAllowed(["member"], "POST", `${sp}/memories`)).not.toThrow();
    expect(() => assertSpaceWriteAllowed(["admin"], "DELETE", sp)).not.toThrow();
    expect(isOwnerRole([VIEWER_ROLE])).toBe(false);
  });

  it("guests cannot create spaces, accept invites or change the account", () => {
    const guest = { guest: true };
    for (const [m, r] of [["POST", "/api/app/spaces"], ["POST", "/api/invites"], ["PATCH", "/api/auth/me"], ["POST", "/api/auth/password"], ["POST", "/api/auth/passkeys"], ["POST", "/api/auth/verification"], ["POST", `${sp}/agents`]] as const) {
      expect(() => assertGuestAllowed(guest, m, r), `${m} ${r}`).toThrow(expect.objectContaining({ code: "read_only" }));
    }
    expect(() => assertGuestAllowed(guest, "GET", "/api/app/spaces")).not.toThrow();
    expect(() => assertGuestAllowed(guest, "POST", `${sp}/recall`)).not.toThrow();
    expect(() => assertGuestAllowed({ guest: false }, "POST", "/api/app/spaces")).not.toThrow();
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
