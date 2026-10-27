/**
 * `.env.example` says it lists every variable Engram reads, so this keeps that true: a new `process.env.X`
 * anywhere in the repo fails here until the file explains it. Platform-injected names (NETLIFY, CONTEXT, URL,
 * NODE_ENV, CI, …) count as read, and are listed under their own heading rather than as settings to copy.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ROOTS = ["packages", "apps", "scripts", "functions"];
const SKIP = new Set(["node_modules", ".next", "dist", "test-results", "playwright-report", ".engram-local"]);
const CODE = /\.(ts|tsx|mts|mjs|js)$/;

const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /process\.env\["([A-Z][A-Z0-9_]{2,})"\]/g,
  /\benv\("([A-Z][A-Z0-9_]{2,})"\)/g,
  /\bbool\("([A-Z][A-Z0-9_]{2,})"/g,
  /\benv\.([A-Z][A-Z0-9_]{2,})\b/g,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.test(name)) out.push(p);
  }
  return out;
}

function readVars(): Set<string> {
  const names = new Set<string>();
  for (const r of ROOTS) for (const f of walk(join(root, r))) {
    const src = readFileSync(f, "utf8");
    for (const re of PATTERNS) for (const m of src.matchAll(re)) names.add(m[1]);
  }
  return names;
}

describe(".env.example", () => {
  it("mentions every environment variable the code reads", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    const missing = [...readVars()].filter((n) => !new RegExp(`\\b${n}\\b`).test(example)).sort();
    expect(missing, `add these to .env.example: ${missing.join(", ")}`).toEqual([]);
  });

  it("still claims to be the full list, so the test above is the thing keeping it honest", () => {
    expect(readFileSync(join(root, ".env.example"), "utf8")).toContain("Every variable Engram reads");
  });
});
