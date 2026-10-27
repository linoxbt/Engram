/**
 * `pnpm setup:appwrite` treats every 409 as "already exists", so before these checks a resource that had drifted
 * from the spec (a changed dimension, bucket limit or backup retention) was a silent no-op on a live project.
 */
import { describe, expect, it } from "vitest";
import {
  BACKUP_SCHEDULE, CHECKPOINTS_BUCKET, COLLECTIONS, INDEX_ATTRIBUTES, INDEX_TYPE,
  backupFields, bucketFields, collectionFields, driftOf, indexFields,
} from "../lib/setup-spec";

const memories = COLLECTIONS.find((c) => c.id === "memories")!;

describe("setup drift", () => {
  it("says nothing when the live project matches the spec", () => {
    expect(driftOf("collection memories", collectionFields(memories), collectionFields({ ...memories }))).toEqual([]);
    expect(driftOf("bucket checkpoints", bucketFields(CHECKPOINTS_BUCKET), bucketFields({ ...CHECKPOINTS_BUCKET }))).toEqual([]);
  });

  it("reports a collection whose dimension, documentSecurity or description changed", () => {
    const live = { ...memories, dimension: 384, documentSecurity: false, description: "old text" };
    const lines = driftOf("collection memories", collectionFields(memories), collectionFields(live));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("collection memories: dimension is 384, this setup asks for 768");
    expect(lines.join(" ")).toContain("documentSecurity");
    expect(lines.join(" ")).toContain("description");
  });

  it("reports an index built with another metric, which keying on the name alone would miss", () => {
    const lines = driftOf("index memories.emb_cosine", { type: INDEX_TYPE, attributes: INDEX_ATTRIBUTES },
      indexFields({ type: "hnsw_euclidean", attributes: ["embeddings"] }));
    expect(lines).toEqual(['index memories.emb_cosine: type is "hnsw_euclidean", this setup asks for "hnsw_cosine"']);
  });

  it("reports a bucket whose size limit or extension list changed, whatever the extension order", () => {
    const live = { ...CHECKPOINTS_BUCKET, maximumFileSize: 100, allowedFileExtensions: ["json", "txt"] };
    const lines = driftOf("bucket checkpoints", bucketFields(CHECKPOINTS_BUCKET), bucketFields(live));
    expect(lines.join(" ")).toContain("maximumFileSize is 100");
    expect(lines.join(" ")).toContain("allowedFileExtensions");
    expect(driftOf("b", bucketFields({ ...CHECKPOINTS_BUCKET, allowedFileExtensions: ["json", "csv"] }),
      bucketFields({ ...CHECKPOINTS_BUCKET, allowedFileExtensions: ["csv", "json"] }))).toEqual([]);
  });

  it("reports a backup policy whose retention no longer matches ENGRAM_BACKUP_RETENTION_DAYS", () => {
    const lines = driftOf("backup policy engram-daily", { retention: 30, schedule: BACKUP_SCHEDULE, enabled: true, resourceId: "engram" },
      backupFields({ retention: 7, schedule: BACKUP_SCHEDULE, enabled: true, resourceId: "engram" }));
    expect(lines).toEqual(["backup policy engram-daily: retention is 7, this setup asks for 30"]);
  });

  it("keeps the dimensions the engine expects", () => {
    expect(Object.fromEntries(COLLECTIONS.map((c) => [c.id, c.dimension]))).toEqual({ memories: 768, concepts: 768, agents: 384, recalls: 768 });
  });
});
