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

await ensure(`database ${DB}`, () => vdb.create({ databaseId: DB, name: "engram", description: "Engram: verifiable memory for AI agents" }));
for (const c of COLLECTIONS) {
  await ensure(`collection ${c.id} (${c.dimension})`, () => vdb.createCollection({ databaseId: DB, collectionId: c.id, name: c.name, dimension: c.dimension, permissions: [], documentSecurity: c.documentSecurity, description: c.description }));
  await ensure(`index ${c.id}.embeddings hnsw_cosine`, () => vdb.createIndex({ databaseId: DB, collectionId: c.id, key: "emb_cosine", type: VectorsDBIndexType.HnswCosine, attributes: ["embeddings"] }));
}
await ensure("bucket checkpoints", () => storage.createBucket({ bucketId: process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints", name: "Signed checkpoints", permissions: [], fileSecurity: true, maximumFileSize: 1_000_000, allowedFileExtensions: ["json"], encryption: false, antivirus: false }));
await ensure("bucket exports", () => storage.createBucket({ bucketId: process.env.APPWRITE_EXPORTS_BUCKET ?? "exports", name: "Space exports", permissions: [], fileSecurity: true, maximumFileSize: 100_000_000, allowedFileExtensions: ["json"] }));

// The HNSW index builds in the background; wait until it is available before benchmarking.
for (const c of COLLECTIONS) {
  for (let i = 0; i < 60; i++) {
    const idx = await vdb.getIndex({ databaseId: DB, collectionId: c.id, key: "emb_cosine" });
    if (idx.status === "available") { console.log(`✓ index ${c.id} available`); break; }
    if (idx.status === "failed" || idx.status === "stuck") throw new Error(`index ${c.id} is ${idx.status}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log("\nDone. Next: add your hostnames as web platforms, set a daily backup policy on the database, and deploy the Functions.");
