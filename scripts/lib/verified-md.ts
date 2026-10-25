/**
 * docs/verified.md is written by several provisioning steps (experiments, events, appwrite-live, quality). Each
 * step owns one marked section and replaces only that, so running one step never erases another's results.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const VERIFIED_PATH = "docs/verified.md";
const TITLE = "# Live verification results";
const INTRO = "Written by the provisioning steps against the live Appwrite project (see README, \"Provisioning from the hosting build\"). Each section is replaced only by the step that owns it.";
const SECTION_RE = /<!-- engram:section ([a-z0-9-]+) -->\n([\s\S]*?)<!-- engram:end \1 -->/g;
const ORDER = ["core", "events", "appwrite-live", "quality"];

export function parseSections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of md.matchAll(SECTION_RE)) out.set(m[1], m[2].trimEnd());
  // A file from before sections existed: keep its body as the core section.
  if (!out.size && md.trim()) out.set("core", md.replace(/^# .*\n/, "").trim());
  return out;
}

export function renderSections(sections: Map<string, string>): string {
  const names = [...ORDER.filter((n) => sections.has(n)), ...[...sections.keys()].filter((n) => !ORDER.includes(n)).sort()];
  return `${TITLE}\n\n${INTRO}\n\n${names.map((n) => `<!-- engram:section ${n} -->\n${sections.get(n)}\n<!-- engram:end ${n} -->`).join("\n\n")}\n`;
}

export function upsertSection(name: string, body: string, path = VERIFIED_PATH): string {
  const sections = parseSections(existsSync(path) ? readFileSync(path, "utf8") : "");
  sections.set(name, body.trimEnd());
  const md = renderSections(sections);
  writeFileSync(path, md);
  return md;
}

export interface Row { n: number | string; item: string; result: string; ok: boolean | null; action: string }
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
export function table(rows: Row[]): string {
  return `| # | Item | Result | OK | What Engram does |\n|---|------|--------|----|------------------|\n${rows.map((r) => `| ${r.n} | ${cell(r.item)} | ${cell(r.result)} | ${r.ok === null ? "info" : r.ok ? "yes" : "**no**"} | ${cell(r.action)} |`).join("\n")}`;
}
