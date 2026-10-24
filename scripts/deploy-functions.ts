/**
 * Build and deploy Engram's Appwrite Functions from appwrite.json.
 *   pnpm functions:deploy
 * Variables are read from the environment and stored as Function secrets, so
 * CP_PRIVATE_KEY lives only in the checkpoint Function. The Functions use
 * Appwrite's dynamic API key (scopes from appwrite.json), not your server key.
 */
import "./env";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AppwriteException, Client, Functions, ID, Query, Runtime, type ProjectKeyScopes } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

const endpoint = process.env.APPWRITE_ENDPOINT, project = process.env.APPWRITE_PROJECT_ID, key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY."); process.exit(1); }
const fns = new Functions(new Client().setEndpoint(endpoint).setProject(project).setKey(key));

interface FnDef { $id: string; name: string; runtime: string; path: string; entrypoint: string; interval: number; timeout: number; events: string[]; execute: string[]; scopes: string[] }
const defs: FnDef[] = JSON.parse(readFileSync("appwrite.json", "utf8")).functions;

// Which variables each Function needs; only those present in the environment are set.
// Least privilege: the model key only goes to the Functions that call a model.
const SHARED = ["APPWRITE_DB_ID", "APPWRITE_CHECKPOINTS_BUCKET", "CP_KEY_ID", "NEXT_PUBLIC_CP_PUBLIC_KEY", "NEXT_PUBLIC_APP_URL", "ENGRAM_EMBED_PREFIXES", "ENGRAM_VECTOR_FILTERS"];
const MODEL = ["CLASSIFIER_MODEL", "CLASSIFIER_MODELS", "MODEL_API_KEY", "ANTHROPIC_WORKSPACE_ID"];
const VARS: Record<string, string[]> = { checkpoint: [...SHARED, "CP_PRIVATE_KEY", "GITHUB_ANCHOR_TOKEN", "GITHUB_ANCHOR_REPO"], sentinel: [...SHARED, "ENGRAM_ALERT_EMAILS"], labeler: [...SHARED, ...MODEL], reflect: [...SHARED, ...MODEL] };

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
  const existing = (await fns.listVariables({ functionId: f.$id, queries: [Query.limit(100)] })).variables;
  for (const name of VARS[f.$id] ?? SHARED) {
    const value = process.env[name];
    if (!value) continue;
    const secret = /KEY|TOKEN|SECRET/.test(name) && !name.startsWith("NEXT_PUBLIC_");
    const found = existing.find((v) => v.key === name);
    if (found) await fns.updateVariable({ functionId: f.$id, variableId: found.$id, key: name, value, secret });
    else await fns.createVariable({ functionId: f.$id, variableId: ID.unique(), key: name, value, secret });
  }
  const archive = execFileSync("tar", ["-czf", "-", "-C", f.path, "package.json", "dist"], { maxBuffer: 256 * 1024 * 1024 });
  const dep = await fns.createDeployment({ functionId: f.$id, code: InputFile.fromBuffer(archive, `${f.$id}.tar.gz`), activate: true, entrypoint: f.entrypoint, commands: "" });
  console.log(`✓ deployed ${f.$id} (${dep.$id}, ${Math.round(archive.length / 1024)} KB)`);
}
