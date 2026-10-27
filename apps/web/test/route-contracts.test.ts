/**
 * Guarantees the route wrappers and route files must keep. They live in Next.js modules (`server-only`, request
 * context) that cannot be imported here, so these read the sources: a route that drops one of them is caught
 * before it ships rather than by a bill or a leak.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

