/**
 * Unit tests for the production storage adapter (backend/appwrite.ts) against a mocked node-appwrite SDK.
 * Query and AppwriteException are the real ones, so the exact query strings sent to Appwrite are asserted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppwriteException, Query } from "node-appwrite";

const sdk = vi.hoisted(() => ({
  vdb: {} as Record<string, ReturnType<typeof vi.fn>>,
  storage: {} as Record<string, ReturnType<typeof vi.fn>>,
  embeddings: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("node-appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-appwrite")>();
  const proxy = (target: Record<string, ReturnType<typeof vi.fn>>) =>
    class { constructor() { return new Proxy({}, { get: (_, k: string) => target[k] ??= vi.fn(async () => { throw new Error(`unmocked SDK call ${k}`); }) }); } };
  return { ...actual, VectorsDB: proxy(sdk.vdb), Storage: proxy(sdk.storage), Embeddings: proxy(sdk.embeddings) };
});

import { createAppwriteBackend } from "../src/backend/appwrite";
import { getConfig, type EngramConfig } from "../src/config";
import { ConflictError, EngramError, isConflict, isEngramError } from "../src/errors";

const ex = (code: number, type = "", message = type || `error ${code}`) => new AppwriteException(message, code, type, "");
const DB = "engram";

function backend(patch: Partial<EngramConfig> = {}) {
  const base = getConfig();
  return createAppwriteBackend({ ...base, vectorFilters: true, ...patch, appwrite: { ...base.appwrite, endpoint: "https://appwrite.test/v1", projectId: "p", apiKey: "standard_test", databaseId: DB } });
}
const mock = (target: Record<string, ReturnType<typeof vi.fn>>, name: string, impl: (...a: any[]) => unknown) => (target[name] = vi.fn(impl as any));
const queriesOf = (fn: ReturnType<typeof vi.fn>, call = 0) => (fn.mock.calls[call][0] as { queries: string[] }).queries;

beforeEach(() => {
  for (const t of [sdk.vdb, sdk.storage, sdk.embeddings]) for (const k of Object.keys(t)) delete t[k];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("query mapping", () => {
  it("maps every filter to Appwrite queries, with null meaning isNull", async () => {
    const createQuery = mock(sdk.vdb, "createQuery", async () => ({ documents: [] }));
    await backend().vectors.query("memories", {
      filters: [
        { op: "eq", path: "metadata.space", values: ["abcdefgh"] },
        { op: "eq", path: "metadata.subject", values: ["customer:ada", null] },
        { op: "eq", path: "metadata.agent", values: [null] },
        { op: "ne", path: "metadata.status", value: "forgotten" },
        { op: "ne", path: "metadata.d.concept", value: null },
        { op: "lt", path: "metadata.seq", value: "000000000010" },
        { op: "lte", path: "metadata.createdAt", value: "2026-10-20T00:00:00.000Z" },
        { op: "gt", path: "metadata.seq", value: "000000000001" },
        { op: "gte", path: "metadata.importance", value: "03" },
        { op: "isNull", path: "metadata.d.forgottenAt" },
        { op: "isNotNull", path: "metadata.d.supersededBy" },
        { op: "contains", path: "metadata.tags", value: "billing" },
        { op: "startsWith", path: "metadata.subject", value: "customer:" },
      ],
      order: { field: "$id", dir: "desc" }, cursorAfter: "m_abcdefgh_000000000004", limit: 7, withVectors: false,
    });
    expect(createQuery).toHaveBeenCalledTimes(1);
    const call = createQuery.mock.calls[0][0] as { databaseId: string; collectionId: string; queries: string[]; total: boolean };
    expect(call).toMatchObject({ databaseId: DB, collectionId: "memories", total: false });
    expect(call.queries).toEqual([
      Query.equal("metadata.space", ["abcdefgh"]),
      Query.or([Query.equal("metadata.subject", ["customer:ada"]), Query.isNull("metadata.subject")]),
      Query.isNull("metadata.agent"),
      Query.notEqual("metadata.status", "forgotten"),
      Query.isNotNull("metadata.d.concept"),
      Query.lessThan("metadata.seq", "000000000010"),
      Query.lessThanEqual("metadata.createdAt", "2026-10-20T00:00:00.000Z"),
      Query.greaterThan("metadata.seq", "000000000001"),
      Query.greaterThanEqual("metadata.importance", "03"),
      Query.isNull("metadata.d.forgottenAt"),
      Query.isNotNull("metadata.d.supersededBy"),
      Query.contains("metadata.tags", "billing"),
      Query.startsWith("metadata.subject", "customer:"),
      Query.orderDesc("$id"),
      Query.cursorAfter("m_abcdefgh_000000000004"),
      Query.limit(7),
      Query.select(["$id", "$createdAt", "$updatedAt", "metadata"]),
    ]);
  });

  it("vector queries skip ordering and select, and default the limit to 25", async () => {
    const createQuery = mock(sdk.vdb, "createQuery", async () => ({ documents: [] }));
    await backend().vectors.query("memories", { vector: [1, 0], order: { field: "$createdAt", dir: "asc" }, withVectors: false });
    expect(queriesOf(createQuery)).toEqual([Query.vectorCosine("embeddings", [1, 0]), Query.limit(25)]);
  });

  it("without vector filters, over-fetches by vector and filters in code", async () => {
    const createQuery = mock(sdk.vdb, "createQuery", async () => ({
      documents: [
        { $id: "a", embeddings: [1, 0], $distance: 0.1, metadata: { space: "s1" } },
        { $id: "b", embeddings: [1, 0], $distance: 0.2, metadata: { space: "s2" } },
      ],
    }));
    const docs = await backend({ vectorFilters: false }).vectors.query("memories", { vector: [1, 0], filters: [{ op: "eq", path: "metadata.space", values: ["s2"] }], limit: 3 });
    expect(queriesOf(createQuery)).toEqual([Query.vectorCosine("embeddings", [1, 0]), Query.limit(200)]);
    expect(docs.map((d) => d.$id)).toEqual(["b"]);
  });
});

describe("$distance and select fallbacks", () => {
  it("computes cosine distance from returned embeddings when $distance is missing, then drops vectors if not wanted", async () => {
    mock(sdk.vdb, "createQuery", async () => ({
      documents: [
        { $id: "same", embeddings: [1, 0], metadata: {} },
        { $id: "orth", embeddings: [0, 1], metadata: {} },
        { $id: "given", embeddings: [0, 1], $distance: 0.42, metadata: {} },
        { $id: "novec", metadata: {} },
      ],
    }));
    const docs = await backend().vectors.query("memories", { vector: [1, 0], withVectors: false });
    expect(docs.map((d) => [d.$id, d.$distance === undefined ? undefined : Number(d.$distance.toFixed(6))])).toEqual([["same", 0], ["orth", 1], ["given", 0.42], ["novec", undefined]]);
    expect(docs.every((d) => d.embeddings === undefined)).toBe(true);
  });

  it("keeps embeddings for vector queries that want them", async () => {
    mock(sdk.vdb, "createQuery", async () => ({ documents: [{ $id: "x", embeddings: [0.6, 0.8], metadata: {} }] }));
    const [d] = await backend().vectors.query("memories", { vector: [0.6, 0.8] });
    expect(d.embeddings).toEqual([0.6, 0.8]);
    expect(d.$distance).toBeCloseTo(0, 6);
  });

  it("switches select off after Appwrite rejects it, and retries without it", async () => {
    const createQuery = mock(sdk.vdb, "createQuery", async ({ queries }: { queries: string[] }) => {
      if (queries.some((q) => q.includes('"select"'))) throw ex(400, "general_query_invalid", "Invalid select query: attribute not found");
      return { documents: [{ $id: "a", metadata: {} }] };
    });
    const b = backend();
    expect(await b.vectors.query("memories", { limit: 1, withVectors: false })).toHaveLength(1);
    await b.vectors.query("memories", { limit: 1, withVectors: false });
    expect(createQuery).toHaveBeenCalledTimes(3);
    expect(queriesOf(createQuery, 2).some((q) => q.includes('"select"'))).toBe(false);
  });

  it("does not treat other 400s as a select problem", async () => {
    mock(sdk.vdb, "createQuery", async () => { throw ex(400, "general_argument_invalid", "Invalid limit"); });
    await expect(backend().vectors.query("memories", { withVectors: false })).rejects.toMatchObject({ code: 400 });
  });
});

describe("conditional writes", () => {
  it("falls back to compare-and-swap when transactions fail with transaction_not_found, and stays there", async () => {
    const createTransaction = mock(sdk.vdb, "createTransaction", async () => ({ $id: "tx1" }));
    mock(sdk.vdb, "createOperations", async () => { throw ex(404, "transaction_not_found"); });
    const rollback = mock(sdk.vdb, "updateTransaction", async () => { throw ex(404, "transaction_not_found"); });
    const updateDocuments = mock(sdk.vdb, "updateDocuments", async () => ({ total: 1, documents: [{ $id: "m1" }] }));
    mock(sdk.vdb, "getDocument", async () => ({ $id: "m1", $updatedAt: "t2", metadata: { n: "1" } }));
    const b = backend();

    const doc = await b.vectors.update("memories", "m1", { metadata: { n: "1" } }, undefined, { ifUpdatedAt: "t1" });
    expect(doc.$updatedAt).toBe("t2");
    expect(rollback).toHaveBeenCalledWith({ transactionId: "tx1", rollback: true });
    expect(updateDocuments).toHaveBeenCalledWith({ databaseId: DB, collectionId: "memories", data: { metadata: { n: "1" } }, queries: [Query.equal("$id", ["m1"]), Query.equal("$updatedAt", ["t1"])] });

    await b.vectors.update("memories", "m1", { metadata: { n: "2" } }, undefined, { ifUpdatedAt: "t2" });
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(updateDocuments).toHaveBeenCalledTimes(2);
  });

  it("raises ConflictError when the filtered update matches no document (someone wrote first)", async () => {
    mock(sdk.vdb, "createTransaction", async () => { throw ex(404, "transaction_not_found"); });
    mock(sdk.vdb, "updateDocuments", async () => ({ total: 0, documents: [] }));
    await expect(backend().vectors.update("memories", "m1", { metadata: {} }, undefined, { ifUpdatedAt: "stale" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("applies a fallback batch in order: CAS updates, plain updates, deletes (404 ignored) and creates", async () => {
    mock(sdk.vdb, "createTransaction", async () => { throw ex(404, "transaction_not_found"); });
    const order: string[] = [];
    mock(sdk.vdb, "updateDocuments", async () => { order.push("cas"); return { documents: [{}] }; });
    mock(sdk.vdb, "updateDocument", async () => { order.push("update"); return {}; });
    mock(sdk.vdb, "deleteDocument", async () => { order.push("delete"); throw ex(404, "document_not_found"); });
    mock(sdk.vdb, "createDocument", async (a: { permissions?: string[] }) => { order.push(`create:${a.permissions?.join(",")}`); return {}; });
    await backend().vectors.transact([
      { action: "update", coll: "memories", id: "a", data: { metadata: {} }, ifUpdatedAt: "t" },
      { action: "update", coll: "memories", id: "b", data: { metadata: {} } },
      { action: "delete", coll: "recalls", id: "c" },
      { action: "create", coll: "concepts", id: "d", data: { embeddings: [1], metadata: {} }, perms: ['read("team:sp_x")'] },
    ]);
    expect(order).toEqual(["cas", "update", "delete", 'create:read("team:sp_x")']);
  });

  it("commits a working transaction after re-reading conditional documents", async () => {
    mock(sdk.vdb, "createTransaction", async () => ({ $id: "tx" }));
    const ops = mock(sdk.vdb, "createOperations", async () => ({}));
    mock(sdk.vdb, "getDocument", async () => ({ $id: "a", $updatedAt: "t" }));
    const upd = mock(sdk.vdb, "updateTransaction", async () => ({}));
    await backend().vectors.transact([
      { action: "update", coll: "memories", id: "a", data: { metadata: { x: "1" } }, ifUpdatedAt: "t" },
      { action: "delete", coll: "memories", id: "b" },
    ]);
    expect(ops.mock.calls[0][0]).toEqual({
      transactionId: "tx",
      operations: [
        { action: "update", databaseId: DB, collectionId: "memories", documentId: "a", data: { metadata: { x: "1" } } },
        { action: "delete", databaseId: DB, collectionId: "memories", documentId: "b" },
      ],
    });
    expect(upd).toHaveBeenCalledWith({ transactionId: "tx", commit: true });
  });

  it("rolls back and raises ConflictError when a staged document changed before commit", async () => {
    mock(sdk.vdb, "createTransaction", async () => ({ $id: "tx" }));
    mock(sdk.vdb, "createOperations", async () => ({}));
    mock(sdk.vdb, "getDocument", async () => ({ $id: "a", $updatedAt: "newer" }));
    const upd = mock(sdk.vdb, "updateTransaction", async () => ({}));
    await expect(backend().vectors.transact([{ action: "update", coll: "memories", id: "a", data: { metadata: {} }, ifUpdatedAt: "t" }])).rejects.toBeInstanceOf(ConflictError);
    expect(upd).toHaveBeenCalledWith({ transactionId: "tx", rollback: true });
    expect(upd).not.toHaveBeenCalledWith({ transactionId: "tx", commit: true });
  });

  it("does not fall back on other transaction errors", async () => {
    mock(sdk.vdb, "createTransaction", async () => ({ $id: "tx" }));
    mock(sdk.vdb, "createOperations", async () => { throw ex(409, "document_already_exists"); });
    mock(sdk.vdb, "updateTransaction", async () => ({}));
    const updateDocuments = mock(sdk.vdb, "updateDocuments", async () => ({ documents: [{}] }));
    await expect(backend().vectors.transact([{ action: "update", coll: "memories", id: "a", data: { metadata: {} }, ifUpdatedAt: "t" }])).rejects.toSatisfy(isConflict);
    expect(updateDocuments).not.toHaveBeenCalled();
  });

  it("create-first: a duplicate ID becomes ConflictError (the chain lock)", async () => {
    mock(sdk.vdb, "createDocument", async () => { throw ex(409, "document_already_exists"); });
    await expect(backend().vectors.create("memories", "m_abcdefgh_000000000001", { embeddings: [1], metadata: {} })).rejects.toBeInstanceOf(ConflictError);
  });

  it("get returns null on 404 and delete ignores 404", async () => {
    mock(sdk.vdb, "getDocument", async () => { throw ex(404, "document_not_found"); });
    mock(sdk.vdb, "deleteDocument", async () => { throw ex(404, "document_not_found"); });
    const b = backend();
    expect(await b.vectors.get("memories", "nope")).toBeNull();
    await expect(b.vectors.delete("memories", "nope")).resolves.toBeUndefined();
  });
});

describe("files", () => {
  const file = (id: string, name = id) => ({ $id: id, name, $createdAt: "2026-10-20T00:00:00.000Z", sizeOriginal: 10 });

  it("lists by name prefix with startsWith, paging by $id", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => file(`cp_s_${String(i).padStart(12, "0")}`));
    const listFiles = mock(sdk.storage, "listFiles", async ({ queries }: { queries: string[] }) => ({ files: queries.some((q) => q.includes("cursorAfter")) ? [file("cp_s_000000000100")] : page1 }));
    const out = await backend().files.list("checkpoints", "cp_s_");
    expect(out).toHaveLength(101);
    expect(queriesOf(listFiles)).toEqual([Query.startsWith("name", "cp_s_"), Query.limit(100), Query.orderAsc("$id")]);
    expect(queriesOf(listFiles, 1)).toContain(Query.cursorAfter("cp_s_000000000099"));
  });

  it("falls back to listing everything and filtering by prefix when startsWith is rejected", async () => {
    const listFiles = mock(sdk.storage, "listFiles", async ({ queries }: { queries: string[] }) => {
      if (queries.some((q) => q.includes("startsWith"))) throw ex(400, "general_query_invalid", "Invalid query: startsWith not allowed on name");
      return { files: [file("b2", "cp_s_000000000002"), file("x", "ex_s_1"), file("a1", "cp_s_000000000001")] };
    });
    const b = backend();
    expect((await b.files.list("checkpoints", "cp_s_")).map((f) => f.name)).toEqual(["cp_s_000000000001", "cp_s_000000000002"]);
    await b.files.list("checkpoints", "cp_s_");
    expect(listFiles).toHaveBeenCalledTimes(3); // the second listing goes straight to the fallback
  });

  it("normalises every body type the SDK may return", async () => {
    const text = '{"seq":"000000000001"}';
    const bytes = new TextEncoder().encode(text);
    const bodies: unknown[] = [
      bytes, bytes.buffer.slice(0), Buffer.from(text), text, new Blob([text]),
      new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 5)); c.enqueue(bytes.slice(5)); c.close(); } }),
    ];
    let i = 0;
    mock(sdk.storage, "getFileView", async () => bodies[i++]);
    const b = backend();
    for (let n = 0; n < bodies.length; n++) expect(new TextDecoder().decode((await b.files.get("checkpoints", "f"))!)).toBe(text);
  });

  it("refuses an unknown body type instead of returning zero bytes, and returns null on 404", async () => {
    mock(sdk.storage, "getFileView", async () => 42);
    await expect(backend().files.get("checkpoints", "f")).rejects.toMatchObject({ code: "internal" });
    mock(sdk.storage, "getFileView", async () => { throw ex(404, "storage_file_not_found"); });
    expect(await backend().files.get("checkpoints", "f")).toBeNull();
  });

  it("create-first files: a duplicate file ID is a ConflictError", async () => {
    mock(sdk.storage, "createFile", async () => { throw ex(409, "storage_file_already_exists"); });
    await expect(backend().files.put("checkpoints", "cpl_s_000000000001", "cpl_s_000000000001", new Uint8Array([1]), [])).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("error mapping", () => {
  const cases: [AppwriteException, string, number][] = [
    [ex(402, "billing_limit_exceeded"), "embeddings_unavailable", 503],
    [ex(404, "document_not_found"), "not_found", 404],
    [ex(429, "general_rate_limit_exceeded"), "rate_limited", 429],
    [ex(404, "collection_not_found"), "unavailable", 503],
    [ex(404, "database_not_found"), "unavailable", 503],
  ];
  it.each(cases)("%s → %s", async (e, code, status) => {
    mock(sdk.vdb, "createQuery", async () => { throw e; });
    const err = await backend().vectors.query("memories", { limit: 1 }).catch((x) => x);
    expect(isEngramError(err)).toBe(true);
    expect(err).toMatchObject({ code, status });
  });

  it("409 → ConflictError; other errors pass through unchanged", async () => {
    mock(sdk.vdb, "updateDocument", async () => { throw ex(409, "document_already_exists"); });
    await expect(backend().vectors.update("memories", "a", { metadata: {} })).rejects.toBeInstanceOf(ConflictError);
    const boom = ex(500, "general_server_error");
    mock(sdk.vdb, "updateDocument", async () => { throw boom; });
    await expect(backend().vectors.update("memories", "a", { metadata: {} })).rejects.toBe(boom);
  });

  it("embeddings: 402 maps to embeddings_unavailable, and a per-text error is not silently skipped", async () => {
    mock(sdk.embeddings, "createTextEmbeddings", async () => { throw ex(402, "billing_limit_exceeded"); });
    await expect(backend().embedder.embed(["a"], "nomic-embed-text")).rejects.toMatchObject({ code: "embeddings_unavailable", status: 503 });
    mock(sdk.embeddings, "createTextEmbeddings", async () => ({ embeddings: [{ embedding: [], error: "model overloaded" }] }));
    await expect(backend().embedder.embed(["a"], "nomic-embed-text")).rejects.toBeInstanceOf(EngramError);
  });

  it("embeds in chunks of 32", async () => {
    const call = mock(sdk.embeddings, "createTextEmbeddings", async ({ texts }: { texts: string[] }) => ({ embeddings: texts.map(() => ({ embedding: [0.1] })) }));
    const out = await backend().embedder.embed(Array.from({ length: 70 }, (_, i) => `t${i}`), "all-minilm");
    expect(out).toHaveLength(70);
    expect(call.mock.calls.map((c) => (c[0] as { texts: string[] }).texts.length)).toEqual([32, 32, 6]);
  });
});
