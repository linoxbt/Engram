/**
 * One-off provisioning from inside the hosting build, which already holds the Appwrite key, so the key never has
 * to be copied anywhere else. Does nothing unless ENGRAM_PROVISION is set; its value names the report file.
 *   setup → experiments (docs/verified.md) → checkpoint signing key → Functions → demo space
 * Writes a redacted report to apps/web/public/_provision/<ENGRAM_PROVISION>.json and never fails the build.
 * The checkpoint private key, when generated here, goes only into the checkpoint Function's secret variables.
 */
import "./env";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client, Functions, ID, Query, Users } from "node-appwrite";
import { generateKeyPair } from "@engram/core";

const run = process.env.ENGRAM_PROVISION ?? "";
if (!/^[a-z0-9]{16,64}$/.test(run)) process.exit(0);

const env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: "0" };
const owner = process.env.ENGRAM_DEMO_OWNER ?? "engramdb@gmail.com";
const demoName = process.env.ENGRAM_DEMO_NAME ?? "Northwind support";
const report: Record<string, unknown> = { run, startedAt: new Date().toISOString(), steps: [] as unknown[] };

const redact = (text: string) => {
  let out = text;
  for (const k of ["APPWRITE_API_KEY", "MODEL_API_KEY", "CP_PRIVATE_KEY", "GITHUB_ANCHOR_TOKEN", "CRON_SECRET", "SEED_ADMIN_TOKEN"]) {
    const v = env[k];
    if (v && v.length >= 8) out = out.split(v).join(`<${k}>`);
  }
  return out.replace(/eng_[A-Za-z0-9]{4}_[A-Za-z0-9]{32}/g, "eng_****_<agent key hidden>");
};

function step(name: string, script: string, args: string[] = [], timeoutMin = 10) {
  const t = Date.now();
  const r = spawnSync("npx", ["tsx", script, ...args], { env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: timeoutMin * 60_000, maxBuffer: 32 * 1024 * 1024 });
  const output = redact(`${r.stdout ?? ""}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}${r.error ? `\n[error] ${r.error.message}` : ""}`);
  const entry = { name, ok: r.status === 0, status: r.status, ms: Date.now() - t, output: output.slice(-12_000) };
  (report.steps as unknown[]).push(entry);
  console.log(`[provision] ${name}: ${entry.ok ? "ok" : `exit ${r.status}`} in ${entry.ms} ms`);
  return { ...entry, raw: r.stdout ?? "" };
}

const client = new Client().setEndpoint(env.APPWRITE_ENDPOINT ?? "").setProject(env.APPWRITE_PROJECT_ID ?? "").setKey(env.APPWRITE_API_KEY ?? "");

try {
  const setup = step("setup", "scripts/setup.ts", [], 20);
  if (setup.ok) {
    step("experiments", "scripts/experiments.ts");
    if (existsSync("docs/verified.md")) report.verifiedMd = readFileSync("docs/verified.md", "utf8");

    // Signing key: keep the one the checkpoint Function already holds; otherwise make a new pair here.
    let functionHasKey = false;
    try {
      const vars = await new Functions(client).listVariables({ functionId: "checkpoint", queries: [Query.limit(100)] });
      functionHasKey = vars.variables.some((v) => v.key === "CP_PRIVATE_KEY");
    } catch { /* the Function does not exist yet */ }
    if (!env.CP_PRIVATE_KEY && !functionHasKey) {
      const kp = await generateKeyPair();
      env.CP_PRIVATE_KEY = kp.privateKey;
      env.NEXT_PUBLIC_CP_PUBLIC_KEY = kp.publicKey;
      report.checkpointKey = { generated: true, publicKey: kp.publicKey, note: "Set NEXT_PUBLIC_CP_PUBLIC_KEY to this value and redeploy." };
    } else {
      report.checkpointKey = { generated: false, functionHasKey };
    }

    step("functions", "scripts/deploy-functions.ts", [], 15);

    // The demo space belongs to the project's own account; its owner can set a password with "Forgot password".
    const users = new Users(client);
    const found = (await users.list({ queries: [Query.equal("email", [owner]), Query.limit(1)] })).users[0];
    const ownerId = found?.$id ?? (await users.create({ userId: ID.unique(), email: owner, name: "Engram" })).$id;
    const teams = (await users.listMemberships({ userId: ownerId, queries: [Query.limit(100)] })).memberships;
    let existing = teams.find((m) => m.teamId.startsWith("sp_") && m.teamName === demoName);
    // ENGRAM_DEMO_RESET=<run id> deletes a half-seeded demo space once, so the next seed starts clean.
    if (existing && env.ENGRAM_DEMO_RESET === run) {
      const del = step("demo reset", "scripts/delete-space.ts", [existing.teamId.slice(3)]);
      if (del.ok) existing = undefined;
    }
    if (existing) {
      report.demo = { spaceKey: existing.teamId.slice(3), seeded: false, note: "already present" };
    } else {
      const seed = step("seed", "scripts/seed.ts", ["--owner", owner, "--public", "--name", demoName], 15);
      const key = /Seeded space ([a-z0-9]{8})/.exec(seed.raw)?.[1] ?? null;
      report.demo = { spaceKey: key, seeded: seed.ok };
    }
  }
} catch (e) {
  report.error = redact(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
}

report.finishedAt = new Date().toISOString();
mkdirSync("apps/web/public/_provision", { recursive: true });
writeFileSync(`apps/web/public/_provision/${run}.json`, JSON.stringify(report, null, 2));
console.log(`[provision] report written for run ${run.slice(0, 4)}…`);
