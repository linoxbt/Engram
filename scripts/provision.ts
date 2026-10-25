/**
 * One-off provisioning from inside the hosting build, which already holds the Appwrite key, so the key never has
 * to be copied anywhere else. Never fails the build.
 *
 * Runs only when all of these hold (otherwise it logs why and exits 0):
 *  - ENGRAM_PROVISION is set to a run id of 16–64 characters [a-z0-9];
 *  - Netlify's CONTEXT is "production" (deploy previews and branch builds must never deploy unmerged code to the
 *    production Functions), or, outside Netlify only, the script is called with --local.
 *
 * Steps (ENGRAM_PROVISION_STEPS, comma-separated; default: diagnose,setup,experiments,functions,seed; "all" adds
 * the optional appwrite-live, quality and events):
 *   diagnose → setup → experiments → appwrite-live → quality → functions (signing key) → events → seed
 * The whole run is capped at ENGRAM_PROVISION_BUDGET_MIN (default 22) minutes; each step also has its own timeout.
 *
 * Output is redacted (secret env values and generic credential patterns). The report is written only when
 * ENGRAM_REPORT_PUBKEY is set, and only encrypted to that key: apps/web/public/_provision/<run>.enc.json.
 * Decrypt it with `pnpm decrypt-report <private-key-file> <url-or-file>`. Without the key, logs only.
 */
import "./env";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { AppwriteException, Client, Functions, ID, Query, Users } from "node-appwrite";
import { generateKeyPair } from "@engram/core";
import { makeRedactor, redactDeep } from "./lib/redact";
import { encryptReport, parsePublicKey } from "./lib/report-crypto";

const REPORT_DIR = "apps/web/public/_provision";
const log = (msg: string) => console.log(`[provision] ${msg}`);

// Plaintext reports from older builds must never be published again, whether or not this run provisions.
if (existsSync(REPORT_DIR)) {
  for (const f of readdirSync(REPORT_DIR)) if (!f.endsWith(".enc.json")) { rmSync(`${REPORT_DIR}/${f}`, { force: true, recursive: true }); log(`removed plaintext report ${f}`); }
}

const DEFAULT_STEPS = ["diagnose", "setup", "experiments", "functions", "seed"];
const OPTIONAL_STEPS = ["appwrite-live", "quality", "events"];

const run = process.env.ENGRAM_PROVISION ?? "";
if (!run) { log("ENGRAM_PROVISION is not set; nothing to do."); process.exit(0); }
if (!/^[a-z0-9]{16,64}$/.test(run)) {
  log(`ENGRAM_PROVISION is set but malformed (${run.length} characters; need 16–64 of [a-z0-9]); skipping.`);
  process.exit(0);
}
const context = process.env.CONTEXT;
const localRun = process.argv.includes("--local") && !process.env.NETLIFY;
if (context !== "production" && !localRun) {
  log(`skipped: Netlify CONTEXT is "${context ?? "unset"}". Provisioning runs only in production builds (or outside Netlify with --local).`);
  process.exit(0);
}

const env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: "0" };
const redact = makeRedactor(env);
const owner = env.ENGRAM_DEMO_OWNER ?? "engramdb@gmail.com";
const demoName = env.ENGRAM_DEMO_NAME ?? "Northwind support";
const budgetMs = Math.min(Math.max(Number(env.ENGRAM_PROVISION_BUDGET_MIN) || 22, 2), 40) * 60_000;
const deadline = Date.now() + budgetMs;

const requested = (env.ENGRAM_PROVISION_STEPS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const known = [...DEFAULT_STEPS, ...OPTIONAL_STEPS];
for (const s of requested) if (s !== "all" && !known.includes(s)) log(`unknown step "${s}" ignored (known: ${known.join(", ")}, all)`);
const steps = new Set(requested.includes("all") ? known : requested.length ? requested.filter((s) => known.includes(s)) : DEFAULT_STEPS);
const wants = (name: string) => steps.has(name);

interface StepResult { name: string; ok: boolean; skipped?: string; status: number | null; ms: number; output: string }
const report: Record<string, unknown> = { run, context: context ?? "local", startedAt: new Date().toISOString(), steps: [] as StepResult[], plan: [...steps] };
const record = (r: StepResult) => { (report.steps as StepResult[]).push(r); return r; };

/** Runs a script in a child process (one process, so a timeout kills it whole) and returns its redacted output. */
function step(name: string, script: string, args: string[] = [], timeoutMin = 5, extraEnv: Record<string, string> = {}): StepResult & { stdout: string } {
  const remaining = deadline - Date.now();
  if (remaining < 60_000) {
    log(`${name}: skipped, the ${budgetMs / 60_000}-minute budget is used up`);
    return { ...record({ name, ok: false, skipped: "budget", status: null, ms: 0, output: "" }), stdout: "" };
  }
  const t = Date.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    env: { ...env, ...extraEnv } as NodeJS.ProcessEnv, encoding: "utf8", timeout: Math.min(timeoutMin * 60_000, remaining), killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = redact(r.stdout ?? "");
  const output = redact(`${r.stdout ?? ""}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}${r.error ? `\n[error] ${r.error.message}` : ""}`);
  const entry = record({ name, ok: r.status === 0, status: r.status, ms: Date.now() - t, output: output.slice(-12_000) });
  log(`${name}: ${entry.ok ? "ok" : r.error ? `stopped (${redact(r.error.message)})` : `exit ${r.status}`} in ${entry.ms} ms`);
  if (!entry.ok) for (const line of output.trimEnd().split("\n").slice(-15)) log(`  ${name} | ${line}`);
  return { ...entry, stdout };
}
const skip = (name: string, why: string) => { log(`${name}: skipped (${why})`); record({ name, ok: false, skipped: why, status: null, ms: 0, output: "" }); };

try {
  const missing = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Appwrite is not configured in this build: set ${missing.join(", ")}`);
  const client = new Client().setEndpoint(env.APPWRITE_ENDPOINT!).setProject(env.APPWRITE_PROJECT_ID!).setKey(env.APPWRITE_API_KEY!);
  if (wants("diagnose")) {
    const d = step("diagnose", "scripts/diagnose.ts", [], 2);
    try { report.diagnose = JSON.parse(d.stdout); } catch { report.diagnose = d.stdout.slice(-20_000); }
  }
  const setup = wants("setup") ? step("setup", "scripts/setup.ts", [], 8) : { ok: true };
  if (!setup.ok) {
    for (const s of ["experiments", "appwrite-live", "quality", "functions", "events", "seed"]) if (wants(s)) skip(s, "setup failed");
  } else {
    if (wants("experiments")) step("experiments", "scripts/experiments.ts", [], 5);
    if (wants("appwrite-live")) step("appwrite-live", "scripts/appwrite-live.ts", [], 5);
    if (wants("quality")) step("quality", "scripts/quality.ts", ["--record"], 5);

    if (wants("functions")) {
      // Signing key: keep the one the checkpoint Function already holds. Only a definite "the Function does not
      // exist" (404) may lead to a new key; any other error means we cannot tell, so nothing is generated or deployed.
      let keyState: "present" | "absent" | "unknown" = "unknown";
      try {
        const vars = await new Functions(client).listVariables({ functionId: env.CHECKPOINT_FUNCTION_ID || "checkpoint", queries: [Query.limit(100)] });
        keyState = vars.variables.some((v) => v.key === "CP_PRIVATE_KEY") ? "present" : "absent";
      } catch (e) {
        if (e instanceof AppwriteException && e.code === 404) keyState = "absent";
        else report.checkpointKeyError = redact(e instanceof AppwriteException ? `${e.code} ${e.type}: ${e.message}` : String(e));
      }
      if (keyState === "unknown") {
        report.checkpointKey = { generated: false, state: "unknown" };
        skip("functions", "could not read the checkpoint Function's variables, so its signing key state is unknown");
      } else {
        if (!env.CP_PRIVATE_KEY && keyState === "absent") {
          const kp = await generateKeyPair();
          env.CP_PRIVATE_KEY = kp.privateKey;
          env.NEXT_PUBLIC_CP_PUBLIC_KEY = kp.publicKey;
          report.checkpointKey = { generated: true, publicKey: kp.publicKey, note: "Add this key to CP_PUBLIC_KEYS and NEXT_PUBLIC_CP_PUBLIC_KEYS (keyId:hex) and redeploy." };
        } else report.checkpointKey = { generated: false, state: keyState, fromEnv: !!env.CP_PRIVATE_KEY };
        step("functions", "scripts/deploy-functions.ts", [], 8);
      }
    }
    if (wants("events")) step("events", "scripts/experiments.ts", ["--events"], 6);

    if (wants("seed")) {
      // The demo space belongs to the project's own account; its owner can set a password with "Forgot password".
      const users = new Users(client);
      const found = (await users.list({ queries: [Query.equal("email", [owner]), Query.limit(1)] })).users[0];
      const ownerId = found?.$id ?? (await users.create({ userId: ID.unique(), email: owner, name: "Engram" })).$id;
      const teams = (await users.listMemberships({ userId: ownerId, queries: [Query.limit(100)] })).memberships;
      let existing = teams.find((m) => m.teamId.startsWith("sp_") && m.teamName === demoName);
      // ENGRAM_DEMO_RESET=<run id> deletes a half-seeded demo space once, so the next seed starts clean.
      if (existing && env.ENGRAM_DEMO_RESET === run) {
        const del = step("demo reset", "scripts/delete-space.ts", [existing.teamId.slice(3)], 3);
        if (del.ok) existing = undefined;
      }
      if (existing) report.demo = { spaceKey: existing.teamId.slice(3), seeded: false, note: "already present" };
      else {
        const seed = step("seed", "scripts/seed.ts", ["--owner", owner, "--public", "--name", demoName], 8);
        report.demo = { spaceKey: /Seeded space ([a-z0-9]{8})/.exec(seed.stdout)?.[1] ?? null, seeded: seed.ok };
      }
    }
  }
  if (existsSync("docs/verified.md")) report.verifiedMd = readFileSync("docs/verified.md", "utf8");
} catch (e) {
  report.error = redact(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
  log(`error: ${redact(e instanceof Error ? e.message : String(e))}`);
}

report.finishedAt = new Date().toISOString();
const safe = redactDeep(report, redact);
const summary = (safe.steps as StepResult[]).map((s) => `${s.name}=${s.skipped ? `skipped(${s.skipped})` : s.ok ? "ok" : `exit ${s.status}`}`).join(" ");
log(`done: ${summary}`);
if (safe.demo) log(`demo space: ${JSON.stringify(safe.demo)}`);
if (safe.checkpointKey) log(`checkpoint key: ${JSON.stringify(safe.checkpointKey)}`);

const pub = env.ENGRAM_REPORT_PUBKEY?.trim();
if (!pub) log("ENGRAM_REPORT_PUBKEY is not set; no report file written (see the log lines above).");
else {
  try {
    const envelope = encryptReport(JSON.stringify(safe), parsePublicKey(pub));
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(`${REPORT_DIR}/${run}.enc.json`, JSON.stringify(envelope));
    log(`encrypted report written: /_provision/${run.slice(0, 4)}….enc.json (decrypt with pnpm decrypt-report)`);
  } catch (e) {
    log(`could not encrypt the report (${e instanceof Error ? e.message : e}); no report file written.`);
  }
}
