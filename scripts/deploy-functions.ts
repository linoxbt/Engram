/**
 * Build and deploy Engram's Appwrite Functions from appwrite.json.
 *   pnpm functions:deploy                    deploy; never touches an existing CP_PRIVATE_KEY
 *   pnpm functions:deploy -- --rotate-key    replace the signing key; needs a new CP_KEY_ID (docs/key-rotation.md)
 *     [--current-key-id=<id>]                when the Function's current CP_KEY_ID is stored as a secret
 * Variables are read from the environment and stored as Function variables (secrets where they are secret), so
 * CP_PRIVATE_KEY lives only in the checkpoint Function. Every variable plan is checked before anything changes: a
 * missing required variable fails the whole deploy. Variables a Function no longer needs are deleted. The Functions
 * use Appwrite's dynamic API key with the scopes in appwrite.json, not your server key.
 */
import "./env";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AppwriteException, Client, Functions, ID, Query, Runtime, type ProjectKeyScopes } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { planVariables, type ExistingVar, type VarAction } from "./deploy-plan";

const endpoint = process.env.APPWRITE_ENDPOINT, project = process.env.APPWRITE_PROJECT_ID, key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY."); process.exit(1); }
const fns = new Functions(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
const rotateKey = process.argv.includes("--rotate-key");
const currentKeyId = process.argv.find((a) => a.startsWith("--current-key-id="))?.split("=")[1];

interface FnDef { $id: string; name: string; runtime: string; path: string; entrypoint: string; interval: number; timeout: number; events: string[]; execute: string[]; scopes: string[] }
const defs: FnDef[] = JSON.parse(readFileSync("appwrite.json", "utf8")).functions;

async function existingVars(functionId: string): Promise<ExistingVar[]> {
  try {
    return (await fns.listVariables({ functionId, queries: [Query.limit(100)] })).variables.map((v) => ({ $id: v.$id, key: v.key, value: v.value, secret: v.secret }));
  } catch (e) {
    if (e instanceof AppwriteException && e.code === 404) return []; // the Function does not exist yet
    throw e;
  }
}

// Plan every Function's variables first, so a missing variable fails before anything is deployed.
const plans = new Map<string, VarAction[]>();
const errors: string[] = [];
for (const f of defs) {
  const plan = await planVariables(f.$id, process.env, await existingVars(f.$id), { rotateKey, currentKeyId });
  plans.set(f.$id, plan.actions);
  errors.push(...plan.errors);
}
if (errors.length) {
  console.error(`Not deploying:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  process.exit(1);
}

execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "scripts/build-functions.ts"], { stdio: "inherit" });

for (const f of defs) {
  const spec = {
    // Interval scheduling (minutes) works on every Appwrite plan; cron needs a paid plan.
    functionId: f.$id, name: f.name, runtime: f.runtime as Runtime, execute: f.execute, events: f.events, interval: f.interval,
    timeout: f.timeout, entrypoint: f.entrypoint, commands: "", scopes: f.scopes as ProjectKeyScopes[], logging: true, enabled: true,
  };
  const upsert = async () => {
    try { await fns.get({ functionId: f.$id }); await fns.update(spec); console.log(`· updated ${f.$id} (every ${spec.interval || "—"} min)`); }
    catch (e) {
      if (!(e instanceof AppwriteException && e.code === 404)) throw e;
      await fns.create(spec); console.log(`✓ created ${f.$id} (every ${spec.interval || "—"} min)`);
    }
  };
  try { await upsert(); }
  catch (e) {
    if (e instanceof AppwriteException && e.type === "additional_resource_not_allowed") {
      console.warn(`! skipped ${f.$id}: the plan's Function limit is reached (the app covers it inline where possible)`);
      continue;
    }
    // The Free plan allows intervals of 60 minutes or longer; the write path still triggers checkpoints on demand.
    if (!(e instanceof AppwriteException && e.type === "billing_feature_unsupported" && spec.interval && spec.interval < 60)) throw e;
    spec.interval = 60;
    await upsert();
  }
  for (const a of plans.get(f.$id) ?? []) {
    if (a.kind === "keep") { console.log(`  ${f.$id}: ${a.key} kept (${a.reason})`); continue; }
    if (a.kind === "delete") { await fns.deleteVariable({ functionId: f.$id, variableId: a.variableId }); console.log(`  ${f.$id}: removed stale ${a.key}`); continue; }
    // A Function created just now has no variables yet, whatever the plan saw.
    if (a.kind === "update" && a.variableId) await fns.updateVariable({ functionId: f.$id, variableId: a.variableId, key: a.key, value: a.value, secret: a.secret });
    else await fns.createVariable({ functionId: f.$id, variableId: ID.unique(), key: a.key, value: a.value, secret: a.secret });
    if (a.key === "CP_PRIVATE_KEY") console.log(`  ${f.$id}: CP_PRIVATE_KEY ${a.kind === "create" ? "created" : "rotated"}`);
  }
  const archive = execFileSync("tar", ["-czf", "-", "-C", f.path, "package.json", "dist"], { maxBuffer: 256 * 1024 * 1024 });
  const dep = await fns.createDeployment({ functionId: f.$id, code: InputFile.fromBuffer(archive, `${f.$id}.tar.gz`), activate: true, entrypoint: f.entrypoint, commands: "" });
  console.log(`✓ deployed ${f.$id} (${dep.$id}, ${Math.round(archive.length / 1024)} KB)`);
}
