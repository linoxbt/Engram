/**
 * Provision Appwrite for Engram. Idempotent: safe to run again.
 *   pnpm setup:appwrite
 * Creates the VectorsDB database, four collections with HNSW cosine indexes,
 * and the checkpoints and exports buckets.
 */
import "./env";
import { AppwriteException, Client, Storage, VectorsDB, VectorsDBIndexType } from "node-appwrite";

const endpoint = process.env.APPWRITE_ENDPOINT, project = process.env.APPWRITE_PROJECT_ID, key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY."); process.exit(1); }
const DB = process.env.APPWRITE_DB_ID ?? "engram";
const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const vdb = new VectorsDB(client);
const storage = new Storage(client);

async function ensure(label: string, fn: () => Promise<unknown>) {
  try { await fn(); console.log(`✓ created ${label}`); }
  catch (e) {
    if (e instanceof AppwriteException && e.code === 409) console.log(`· ${label} already exists`);
    else { console.error(`✗ ${label}:`, e instanceof Error ? e.message : e); throw e; }
  }
}

// Collections: documentSecurity per Document 2, section 7. No collection-level permissions:
// every document is created by the server with read(team:<space team>).
const COLLECTIONS = [
  { id: "memories", name: "Memories", dimension: 768, documentSecurity: true, description: "Every chain entry: memories, forgets, links, summaries (nomic-embed-text)" },
  { id: "concepts", name: "Concepts", dimension: 768, documentSecurity: true, description: "Concept centroids with labels" },
  { id: "agents", name: "Agents", dimension: 384, documentSecurity: false, description: "Agent registry; vector is the description (all-minilm). Server only." },
  { id: "recalls", name: "Recalls", dimension: 768, documentSecurity: true, description: "Logged recall queries with best distance" },
];

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
for (const c of dbReady ? COLLECTIONS : []) {
  await ensure(`collection ${c.id} (${c.dimension})`, () => vdb.createCollection({ databaseId: DB, collectionId: c.id, name: c.name, dimension: c.dimension, permissions: [], documentSecurity: c.documentSecurity, description: c.description }));
  await ensure(`index ${c.id}.embeddings hnsw_cosine`, () => vdb.createIndex({ databaseId: DB, collectionId: c.id, key: "emb_cosine", type: VectorsDBIndexType.HnswCosine, attributes: ["embeddings"] }));
}
// Look before creating: on a plan at its bucket limit, Appwrite reports the limit before it reports a duplicate.
async function ensureBucket(label: string, bucketId: string, create: () => Promise<unknown>) {
  try { await storage.getBucket({ bucketId }); console.log(`· ${label} already exists`); return; }
  catch (e) { if (!(e instanceof AppwriteException && e.code === 404)) throw e; }
  await ensure(label, create);
}
await ensureBucket("bucket checkpoints", process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints", () => storage.createBucket({ bucketId: process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints", name: "Signed checkpoints", permissions: [], fileSecurity: true, maximumFileSize: 1_000_000, allowedFileExtensions: ["json"], encryption: false, antivirus: false }));
// Exports share the checkpoints bucket unless a separate one is configured (the Free plan allows one bucket).
if (process.env.APPWRITE_EXPORTS_BUCKET && process.env.APPWRITE_EXPORTS_BUCKET !== (process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints")) await ensureBucket("bucket exports", process.env.APPWRITE_EXPORTS_BUCKET!, () => storage.createBucket({ bucketId: process.env.APPWRITE_EXPORTS_BUCKET!, name: "Space exports", permissions: [], fileSecurity: true, maximumFileSize: 100_000_000, allowedFileExtensions: ["json"] }));

// The HNSW index builds in the background; wait until it is available before benchmarking.
for (const c of dbReady ? COLLECTIONS : []) {
  for (let i = 0; i < 60; i++) {
    const idx = await vdb.getIndex({ databaseId: DB, collectionId: c.id, key: "emb_cosine" });
    if (idx.status === "available") { console.log(`✓ index ${c.id} available`); break; }
    if (idx.status === "failed" || idx.status === "stuck") throw new Error(`index ${c.id} is ${idx.status}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!dbReady) process.exitCode = 2;
console.log(dbReady ? "\nDone. Next:" : "\nPartially done (no VectorsDB yet). Next: add your hostnames as web platforms, set a daily backup policy on the database, and deploy the Functions.");
