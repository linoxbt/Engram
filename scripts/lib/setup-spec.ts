/**
 * What `pnpm setup:appwrite` asks the project to look like, and the comparison that finds an existing project
 * drifting from it. Kept apart from scripts/setup.ts so both the wanted shape and the comparison can be tested
 * without an Appwrite project: setup.ts itself connects on import.
 */
import { VectorsDBIndexType } from "node-appwrite";

export interface CollectionSpec { id: string; name: string; dimension: number; documentSecurity: boolean; description: string }

// Collections: documentSecurity per Document 2, section 7. No collection-level permissions:
// every document is created by the server with read(team:<space team>).
export const COLLECTIONS: CollectionSpec[] = [
  { id: "memories", name: "Memories", dimension: 768, documentSecurity: true, description: "Every chain entry: memories, forgets, links, summaries (nomic-embed-text)" },
  { id: "concepts", name: "Concepts", dimension: 768, documentSecurity: true, description: "Concept centroids with labels" },
  { id: "agents", name: "Agents", dimension: 384, documentSecurity: false, description: "Agent registry; vector is the description (all-minilm). Server only." },
  { id: "recalls", name: "Recalls", dimension: 768, documentSecurity: true, description: "Logged recall queries with best distance" },
];

export const INDEX_KEY = "emb_cosine";
export const INDEX_TYPE = String(VectorsDBIndexType.HnswCosine);
export const INDEX_ATTRIBUTES = ["embeddings"];
export const BACKUP_SCHEDULE = "17 3 * * *";

export interface BucketSpec { name: string; fileSecurity: boolean; maximumFileSize: number; allowedFileExtensions: string[] }
export const CHECKPOINTS_BUCKET: BucketSpec = { name: "Signed checkpoints", fileSecurity: true, maximumFileSize: 1_000_000, allowedFileExtensions: ["json"] };
export const EXPORTS_BUCKET: BucketSpec = { name: "Space exports", fileSecurity: true, maximumFileSize: 100_000_000, allowedFileExtensions: ["json"] };

/**
 * One line per field that differs. Appwrite answers 409 for anything that already exists, so without this a
 * changed dimension, bucket limit or backup retention is a silent no-op on a project provisioned earlier.
 */
export function driftOf(label: string, want: Record<string, unknown>, have: Record<string, unknown>): string[] {
  return Object.keys(want)
    .filter((k) => JSON.stringify(want[k]) !== JSON.stringify(have[k]))
    .map((k) => `${label}: ${k} is ${JSON.stringify(have[k])}, this setup asks for ${JSON.stringify(want[k])}`);
}

/** The fields of a live collection this setup owns. */
export const collectionFields = (c: { dimension: number; documentSecurity: boolean; name: string; description: string }) =>
  ({ dimension: c.dimension, documentSecurity: c.documentSecurity, name: c.name, description: c.description });

/** The fields of a live index this setup owns; attribute order is not meaningful. */
export const indexFields = (i: { type: string; attributes: string[] }) => ({ type: String(i.type), attributes: [...i.attributes].sort() });

/** The fields of a live bucket this setup owns; extension order is not meaningful. */
export const bucketFields = (b: BucketSpec) =>
  ({ name: b.name, fileSecurity: b.fileSecurity, maximumFileSize: b.maximumFileSize, allowedFileExtensions: [...b.allowedFileExtensions].sort() });

/** The fields of a live backup policy this setup owns. */
export const backupFields = (p: { retention: number; schedule: string; enabled: boolean; resourceId?: string | null }) =>
  ({ retention: p.retention, schedule: p.schedule, enabled: p.enabled, resourceId: p.resourceId ?? null });
