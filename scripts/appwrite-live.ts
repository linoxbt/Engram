/**
 * The `appwrite-live` provisioning step: runs packages/server/test/appwrite-live.test.ts against the configured
 * Appwrite project (reserved test space key, everything deleted afterwards) and records the results in the
 * appwrite-live section of docs/verified.md.
 *   pnpm tsx scripts/appwrite-live.ts
 */
import "./env";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { table, upsertSection, type Row } from "./lib/verified-md";

const e = process.env;
const endpoint = e.APPWRITE_TEST_ENDPOINT ?? e.APPWRITE_ENDPOINT, project = e.APPWRITE_TEST_PROJECT ?? e.APPWRITE_PROJECT_ID, key = e.APPWRITE_TEST_KEY ?? e.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY (or the APPWRITE_TEST_* variants)."); process.exit(1); }
const space = e.APPWRITE_TEST_SPACE || "test0000";

const out = join(mkdtempSync(join(tmpdir(), "engram-live-")), "results.json");
const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "packages/server/test/appwrite-live.test.ts", "--reporter=json", `--outputFile=${out}`], {
  encoding: "utf8", timeout: 4 * 60_000, killSignal: "SIGKILL",
  env: { ...e, APPWRITE_TEST_ENDPOINT: endpoint, APPWRITE_TEST_PROJECT: project, APPWRITE_TEST_KEY: key, APPWRITE_TEST_SPACE: space } as NodeJS.ProcessEnv,
});

interface Assertion { title: string; status: string; duration?: number; failureMessages?: string[] }
let tests: Assertion[] = [];
try { tests = (JSON.parse(readFileSync(out, "utf8")) as { testResults: { assertionResults: Assertion[] }[] }).testResults.flatMap((t) => t.assertionResults); }
catch { console.error(`vitest produced no results (exit ${r.status}).\n${(r.stdout ?? "").slice(-4000)}\n${(r.stderr ?? "").slice(-4000)}`); process.exit(1); }

const rows: Row[] = tests.map((t, i) => ({
  n: `L${i + 1}`, item: t.title,
  result: t.status === "passed" ? `passed in ${Math.round(t.duration ?? 0)} ms` : `${t.status}: ${(t.failureMessages?.[0] ?? "").split("\n")[0].slice(0, 300)}`,
  ok: t.status === "passed" ? true : t.status === "skipped" || t.status === "pending" ? null : false,
  action: "Adapter integration (packages/server/test/appwrite-live.test.ts)",
}));
if (r.status !== 0 && !rows.some((x) => x.ok === false)) rows.push({ n: "L0", item: "Suite setup", result: `vitest exit ${r.status}: ${(r.stdout ?? "").split("\n").filter((l) => /Error|FAIL/.test(l)).slice(0, 3).join(" ").slice(0, 300)}`, ok: false, action: "See the step output in the provisioning report" });
for (const row of rows) console.log(`${row.ok === null ? "·" : row.ok ? "✓" : "✗"} ${row.item}: ${row.result}`);
const passed = tests.filter((t) => t.status === "passed").length;
upsertSection("appwrite-live", `## Adapter integration suite (live)

Run by the \`appwrite-live\` step on ${new Date().toISOString()} against \`${endpoint}\`, reserved test space \`${space}\`: ${passed}/${tests.length} passed. Every test document and file is deleted afterwards.

${table(rows)}`);
console.log(`\n${passed}/${tests.length} live adapter tests passed; wrote the appwrite-live section of docs/verified.md`);
process.exit(passed === tests.length && tests.length > 0 ? 0 : 1);
