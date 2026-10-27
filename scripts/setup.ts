/**
 * Provision Appwrite for Engram. Idempotent: safe to run again.
 *   pnpm setup:appwrite
 * Creates the VectorsDB database, four collections with HNSW cosine indexes, the checkpoints bucket (and a
 * separate exports bucket only if APPWRITE_EXPORTS_BUCKET names one; exports are streamed, never stored), and a
 * daily backup policy for the database where the plan allows it.
 *
 * Idempotent is not the same as convergent. Appwrite answers 409 for anything that already exists, so on a project
 * provisioned earlier a changed dimension, description, bucket limit or backup retention would otherwise be a
 * silent no-op. Every resource is therefore read back and compared with what this file asks for, and each
 * difference is printed as a drift line and listed again at the end.
 *
 * Drift is reported, not applied. Changing a collection's dimension or a bucket's allowed extensions in place is
 * destructive (every stored vector would become unreadable, existing files would stop being accepted), and this
 * script runs unattended inside the production Netlify build, where an automatic change nobody asked for is the
 * worse failure. Backup retention is the one safe case and still goes through the operator, so there is one rule
 * instead of two. Data migrations are a separate matter: see "Migrations" in docs/architecture.md.
 */
import "./env";
import { AppwriteException, BackupServices, Backups, Client, Storage, VectorsDB, VectorsDBIndexType } from "node-appwrite";
import {
  BACKUP_SCHEDULE, CHECKPOINTS_BUCKET, COLLECTIONS, EXPORTS_BUCKET, INDEX_ATTRIBUTES, INDEX_KEY, INDEX_TYPE,
  backupFields, bucketFields, collectionFields, driftOf, indexFields, type BucketSpec,
} from "./lib/setup-spec";

const endpoint = process.env.APPWRITE_ENDPOINT, project = process.env.APPWRITE_PROJECT_ID, key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY."); process.exit(1); }
const DB = process.env.APPWRITE_DB_ID ?? "engram";
const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const vdb = new VectorsDB(client);
const storage = new Storage(client);

/** Differences between what this setup asks for and what the project already has. Reported, never applied. */
const drift: string[] = [];
function diff(label: string, want: Record<string, unknown>, have: Record<string, unknown>) {
  for (const line of driftOf(label, want, have)) { drift.push(line); console.error(`! drift  ${line}`); }
}

async function ensure(label: string, fn: () => Promise<unknown>) {
  try { await fn(); console.log(`✓ created ${label}`); }
  catch (e) {
    if (e instanceof AppwriteException && e.code === 409) console.log(`· ${label} already exists`);
    else { console.error(`✗ ${label}:`, e instanceof Error ? e.message : e); throw e; }
  }
}

// Appwrite Cloud runs VectorsDB on dedicated compute: pass a specification (default Starter, s-1vcpu-1gb,
// $10/month billed hourly). The organization must have dedicated databases enabled on its plan.
const SPEC = process.env.APPWRITE_VECTORSDB_SPEC ?? "s-1vcpu-1gb";
let dbReady = true;
try {
  await ensure(`database ${DB} (${SPEC})`, () => vdb.create({ databaseId: DB, name: "engram", description: "Engram: verifiable memory for AI agents", specification: SPEC }));
} catch (e) {
  dbReady = false;
  const specs = await vdb.listSpecifications().catch(() => null);
  const enabled = specs?.specifications.filter((x) => x.enabled).map((x) => x.slug) ?? [];
  console.error(`\nVectorsDB database not created. Enabled specifications on this organization: ${enabled.length ? enabled.join(", ") : "none"}.`);
  console.error("VectorsDB needs a dedicated database, which needs the Pro plan: Console → your organization → Billing → upgrade to Pro. Then run this again. Continuing with buckets.\n");
}
// A new dedicated database takes a few minutes to provision. Until it is ready, collection calls can answer
// with a misleading 409 or 404, so wait for "ready" first.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The SDK documents status as a lifecycle string ("provisioning", "ready", ...) but types it as an object with
// a `ready` flag; accept both, and only trust "ready" once listing collections actually works.
const stateOf = (st: unknown) => (st == null ? "ready" : typeof st === "string" ? st : (st as { ready?: boolean }).ready ? "ready" : "provisioning");
if (dbReady) {
  for (let i = 0; ; i++) {
    const db = await vdb.get({ databaseId: DB });
    const state = stateOf(db.status);
    if (state === "failed") throw new Error(`database ${DB} failed to provision: ${db.error ?? "no reason given"}`);
    if (state === "ready" && (await vdb.listCollections({ databaseId: DB }).then(() => true, () => false))) {
      console.log(`✓ database ${DB} is ready${db.specification ? ` (${db.specification})` : ""}`);
      break;
    }
    if (i >= 120) throw new Error(`database ${DB} is still ${state} after 10 minutes; run setup again later`);
    if (i % 6 === 0) console.log(`· database ${DB} is ${state}; waiting`);
    await sleep(5000);
  }
}
/** "Already exists" is only believed once the thing can actually be read back — and the read-back is then diffed. */
async function ensureVerified<T>(label: string, create: () => Promise<unknown>, read: () => Promise<T>, check?: (have: T) => void) {
  for (let i = 0; i < 12; i++) {
    try { await create(); console.log(`✓ created ${label}`); return; }
    catch (e) {
      if (!(e instanceof AppwriteException) || (e.code !== 409 && e.code !== 404)) { console.error(`✗ ${label}:`, e instanceof Error ? e.message : e); throw e; }
      const have = await read().then((x) => x, () => null);
      if (have) { console.log(`· ${label} already exists`); check?.(have); return; }
      await sleep(5000);
    }
  }
  throw new Error(`${label}: Appwrite kept reporting a conflict, but it cannot be read back`);
}
for (const c of dbReady ? COLLECTIONS : []) {
  await ensureVerified(`collection ${c.id} (${c.dimension})`,
    () => vdb.createCollection({ databaseId: DB, collectionId: c.id, name: c.name, dimension: c.dimension, permissions: [], documentSecurity: c.documentSecurity, description: c.description }),
    () => vdb.getCollection({ databaseId: DB, collectionId: c.id }),
    // A wrong dimension is the dangerous one: every vector already stored would be the wrong width.
    (have) => diff(`collection ${c.id}`, collectionFields(c), collectionFields(have)));
  await ensureVerified(`index ${c.id}.embeddings hnsw_cosine`,
    () => vdb.createIndex({ databaseId: DB, collectionId: c.id, key: INDEX_KEY, type: VectorsDBIndexType.HnswCosine, attributes: INDEX_ATTRIBUTES }),
    () => vdb.getIndex({ databaseId: DB, collectionId: c.id, key: INDEX_KEY }),
    // Keyed on the name alone, an index created with another metric or attribute would pass unnoticed.
    (have) => diff(`index ${c.id}.${INDEX_KEY}`, { type: INDEX_TYPE, attributes: INDEX_ATTRIBUTES }, indexFields(have)));
}
// Look before creating: on a plan at its bucket limit, Appwrite reports the limit before it reports a duplicate.
async function ensureBucket(label: string, bucketId: string, want: BucketSpec, extra: Record<string, unknown> = {}) {
  try {
    const have = await storage.getBucket({ bucketId });
    console.log(`· ${label} already exists`);
    // A bucket whose limit or extension list drifted silently rejects checkpoint files at write time, not here.
    diff(label, bucketFields(want), bucketFields(have));
    return;
  } catch (e) { if (!(e instanceof AppwriteException && e.code === 404)) throw e; }
  await ensure(label, () => storage.createBucket({ bucketId, permissions: [], ...want, ...extra }));
}
const checkpointsBucket = process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints";
await ensureBucket("bucket checkpoints", checkpointsBucket, CHECKPOINTS_BUCKET, { encryption: false, antivirus: false });
// Exports share the checkpoints bucket unless a separate one is configured (the Free plan allows one bucket).
if (process.env.APPWRITE_EXPORTS_BUCKET && process.env.APPWRITE_EXPORTS_BUCKET !== checkpointsBucket) {
  await ensureBucket("bucket exports", process.env.APPWRITE_EXPORTS_BUCKET, EXPORTS_BUCKET);
}

// The HNSW index builds in the background; wait until it is available before benchmarking. Not available after
// 3 minutes is an error: recall would silently fall back to slow scans or fail.
for (const c of dbReady ? COLLECTIONS : []) {
  let status = "unknown";
  for (let i = 0; i < 90 && status !== "available"; i++) {
    status = (await vdb.getIndex({ databaseId: DB, collectionId: c.id, key: INDEX_KEY })).status;
    if (status === "failed" || status === "stuck") throw new Error(`index ${c.id} is ${status}`);
    if (status !== "available") await sleep(2000);
  }
  if (status !== "available") throw new Error(`index ${c.id}.${INDEX_KEY} is still "${status}" after 3 minutes; run setup again once it is available`);
  console.log(`✓ index ${c.id} available`);
}

// Daily backup of the database (Appwrite Backups). Idempotent; a plan without backups is reported, not fatal.
let backup = "not attempted";
if (dbReady) {
  const backups = new Backups(client);
  const policyId = `${DB}-daily`.slice(0, 36);
  const retention = Number(process.env.ENGRAM_BACKUP_RETENTION_DAYS) || 7;
  try {
    const p = await backups.getPolicy({ policyId });
    backup = `policy ${p.$id} already exists (${p.schedule}, ${p.retention} days)`;
    // ENGRAM_BACKUP_RETENTION_DAYS only ever reached createPolicy, so changing it did nothing on a live project.
    diff(`backup policy ${policyId}`, { retention, schedule: BACKUP_SCHEDULE, enabled: true, resourceId: DB }, backupFields(p));
  } catch (e) {
    if (!(e instanceof AppwriteException && e.code === 404)) backup = `could not read backup policies: ${e instanceof Error ? e.message : e}`;
    else {
      // VectorsDB runs on a dedicated database; which service name the Backups API wants for it is tried in order.
      for (const service of [BackupServices.Vectorsdb, BackupServices.DedicatedDatabases]) {
        try {
          await backups.createPolicy({ policyId, name: `Daily backup of ${DB}`, services: [service], resourceId: DB, retention, schedule: BACKUP_SCHEDULE, enabled: true });
          backup = `created policy ${policyId} (${service}, daily at 03:17 UTC, ${retention} days)`;
          break;
        } catch (err) {
          const why = err instanceof AppwriteException ? `${err.code} ${err.type}: ${err.message}` : String(err);
          backup = `NOT created (${why}). Backups need a paid plan; create one in the console (Databases → ${DB} → Backups) and keep \`pnpm backup\` exports.`;
          if (!(err instanceof AppwriteException && err.code === 400)) break;
        }
      }
    }
  }
  console.log(`${backup.startsWith("NOT") || backup.startsWith("could") ? "!" : "✓"} backup: ${backup}`);
}
if (drift.length) {
  console.error(`\n! ${drift.length} resource(s) differ from this setup and were NOT changed:`);
  for (const d of drift) console.error(`!   ${d}`);
  console.error("! Apply these in the Appwrite console, or recreate the resource; a dimension change needs a re-embed.");
}
if (!dbReady) process.exitCode = 2;
console.log(dbReady ? "\nDone. Next: add your hostnames as web platforms and deploy the Functions." : "\nPartially done (no VectorsDB yet). Next: add your hostnames as web platforms, run setup again for the backup policy, and deploy the Functions.");
