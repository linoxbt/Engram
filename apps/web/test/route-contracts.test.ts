/**
 * Guarantees the route wrappers and route files must keep. They live in Next.js modules (`server-only`, request
 * context) that cannot be imported here, so these read the sources: a route that drops one of them is caught
 * before it ships rather than by a bill or a leak.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PREFETCH_CSP } from "@/lib/csp";
import { cleanDisplayName } from "@/lib/server/names";
import { SPACE_WORK_LIMITS } from "@/lib/server/limits";

const read = (p: string) => readFileSync(fileURLToPath(new URL("../" + p, import.meta.url)), "utf8");
const space = (p: string) => read("app/api/app/spaces/[key]/" + p);

describe("expensive work is capped for people, not only for agent keys", () => {
  // The engine's own limiter bails out for `user:` actors (packages/server/src/remember.ts), so these routes are
  // the only thing between a signed-in member and an unbounded loop of model calls and full-chain work.
  const costly: [string, keyof typeof SPACE_WORK_LIMITS][] = [
    ["memories/route.ts", "remember"],
    ["concepts/[id]/route.ts", "concept"],
    ["concepts/[id]/reflect/route.ts", "reflect"],
    ["checkpoints/route.ts", "checkpoint"],
    ["conflicts/route.ts", "conflict"],
    ["memories/[id]/forget/route.ts", "forget"],
  ];

  it("every model-backed or chain-writing POST spends a per-person, per-space budget", () => {
    for (const [file, kind] of costly) {
      const src = space(file);
      expect(src, file).toContain(`limitSpaceWork("${kind}"`);
      // Keyed on the person AND the space, the way /export and /verify already are.
      expect(src, file).toMatch(/limitSpaceWork\("[a-z]+", access\.user\.id, ctx\.space\.key\)/);
    }
  });

  it("the budgets are finite and generous enough for a person working by hand", () => {
    for (const [kind, l] of Object.entries(SPACE_WORK_LIMITS)) {
      expect(l.max, kind).toBeGreaterThanOrEqual(20);
      expect(l.max, kind).toBeLessThanOrEqual(1000);
    }
  });

  it("a viewer's verify reads the recorded badge instead of running the chain and emailing the owner", () => {
    const src = space("verify/route.ts");
    expect(src).toMatch(/if \(access\.viewer\) return \{ cached: true, integrity: ctx\.space\.settings\.integrity \}/);
    // The cheap path comes first: nothing below it may run for a viewer.
    expect(src.indexOf("access.viewer")).toBeLessThan(src.indexOf("verifyAndRecord(ctx.b"));
  });
});

describe("the route wrappers", () => {
  const api = read("lib/server/api.ts");

  it("default to a private, uncacheable response that varies on who asked", () => {
    expect(api).toContain('res.headers.set("Cache-Control", "private, no-store")');
    expect(api).toContain('res.headers.set("Vary", "Cookie, Authorization")');
    // Routes with a policy of their own (the public v1 reads, the export download) keep it.
    expect(api).toContain('if (!res.headers.has("cache-control"))');
    expect(read("app/api/v1/spaces/[key]/chain/route.ts")).toContain('"Netlify-Vary": "query"');
  });

  it("never trust a host header the caller writes for the same-origin check", () => {
    expect(api).not.toMatch(/get\("x-forwarded-host"\)/);
    expect(api).toContain('originAllowed(req.headers.get("origin"), own)');
  });

  it("gate a viewer's reads per route, not by method", () => {
    expect(api).toContain("assertViewerReadAllowed(access.user, access, info.method, info.route)");
  });
});

describe("space names and descriptions", () => {
  it("are scrubbed to one plain line where they are accepted, not only where they are shown", () => {
    // They reach an email subject line (the integrity alert), the unauthenticated invite preview and the logs.
    expect(read("app/api/app/spaces/route.ts")).toContain("cleanDisplayName");
    expect(space("settings/route.ts")).toContain("cleanDisplayName");
    expect(cleanDisplayName("Ops\nBcc: victim@example.com")).toBe("Ops Bcc: victim@example.com");
  });
});

describe("page responses", () => {
  it("carry a request ID, so a report about a page can be joined to its log line", () => {
    expect(read("proxy.ts")).toContain('res.headers.set("x-request-id", requestIdFor(req.headers))');
  });

  it("have a policy even when the nonce middleware stands aside for a prefetch", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toContain("PREFETCH_CSP");
    for (const key of ["next-router-prefetch", "purpose"]) expect(cfg).toContain(key);
    // The middleware skips exactly these, so the fallback must not let anything execute.
    expect(PREFETCH_CSP).toContain("script-src 'none'");
    expect(PREFETCH_CSP).toContain("frame-ancestors 'none'");
  });
});

describe("the chain endpoint is the one bulk read a viewer keeps, so it must stay projected", () => {
  // /export was closed to viewers because it hands out content salts. /chain reads the same documents and
  // would hand out the same salts page by page, which is the same leak with more requests.
  it("projects every entry through publicChainEntries before returning it", () => {
    const src = space("chain/route.ts");
    expect(src).toContain("publicChainEntries(");
    expect(src).toMatch(/entries: publicChainEntries\([\s\S]*?access\.viewer,?\s*\)/);
  });

  it("refuses deep mode to a viewer rather than reading vectors it will not return", () => {
    expect(space("chain/route.ts")).toMatch(/sp\.get\("vectors"\) === "1" && !access\.viewer/);
  });

  it("the public v1 chain never grew a text or salt field", () => {
    const src = read("app/api/v1/spaces/[key]/chain/route.ts");
    expect(src).toContain("h: d.metadata.h");
    expect(src).not.toMatch(/metadata\.c\b/);
  });
});
