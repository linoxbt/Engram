/**
 * Day 1 verification experiments (Document 5, section 3) against your Appwrite project.
 *   pnpm experiments              # core items: temporary collection, every check, then deleted (section "core")
 *   pnpm experiments -- --events  # Realtime channel and Function event discovery (section "events")
 * Results go into their own section of docs/verified.md. The engine already has a fallback for each item; this
 * tells you which path you are on.
 */
import "./env";
import { runEventsExperiments } from "./lib/events-experiments";
import { table, upsertSection } from "./lib/verified-md";
import { AppwriteException, Client, Embeddings, EmbeddingModel, ID, Query, Teams, VectorsDB, VectorsDBIndexType } from "node-appwrite";
import { cosine, embHash, entryId, quantize } from "@engram/core";
import { createAppwriteBackend, getConfig, isConflict } from "@engram/server";

const endpoint = process.env.APPWRITE_ENDPOINT, project = process.env.APPWRITE_PROJECT_ID, key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY."); process.exit(1); }
const DB = process.env.APPWRITE_DB_ID ?? "engram";
/** Reserved space key for anything written to the real collections ("0" never appears in generated keys). */
const TEST_SPACE = process.env.APPWRITE_TEST_SPACE || "test0000";

if (process.argv.includes("--events")) {
  const res = await runEventsExperiments({
    endpoint, project, key, db: DB, space: TEST_SPACE, labelerId: process.env.LABELER_FUNCTION_ID || "labeler",
    origin: (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "") || null,
  });
  for (const r of res.rows) console.log(`${r.ok === null ? "·" : r.ok ? "✓" : "✗"} ${r.n}. ${r.item}: ${r.result}`);
  for (const n of res.notes) console.log(`! ${n}`);
  const firedText = res.functionEvents.join(", ")
    || (res.functionExecutions.length ? `${res.functionExecutions.length} execution(s), namespace unknown (no x-appwrite-event header logged)` : "none");
  console.log(`\nRealtime channel: ${res.realtimeChannel ?? "none fired"}\nFunction events that fired: ${firedText}`);
  upsertSection("events", `## Realtime and Function events

Run by the \`events\` step on ${new Date().toISOString()} against \`${endpoint}\`, database \`${DB}\`, reserved test space \`${TEST_SPACE}\`.
Verified channel for the live feed: **${res.realtimeChannel ?? "none (polling)"}**. Function events that fired: **${firedText}**.${res.notes.length ? `\n\nNotes: ${res.notes.join("; ")}` : ""}

${table(res.rows)}`);
  console.log("Wrote the events section of docs/verified.md");
  process.exit(res.rows.every((r) => r.ok !== false) ? 0 : 1);
}

const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const vdb = new VectorsDB(client);
const emb = new Embeddings(client);
const COLL = `exp_${Date.now().toString(36)}`;
const rows: { n: number; item: string; result: string; ok: boolean | null; action: string }[] = [];
const rec = (n: number, item: string, ok: boolean | null, result: string, action: string) => { rows.push({ n, item, result, ok, action }); console.log(`${ok === null ? "·" : ok ? "✓" : "✗"} ${n}. ${item}: ${result}`); };
const err = (e: unknown) => e instanceof AppwriteException ? `${e.code} ${e.type}: ${e.message}` : String(e);
const ms = async <T>(fn: () => Promise<T>) => { const t = performance.now(); const r = await fn(); return [r, Math.round(performance.now() - t)] as const; };

const embed = async (texts: string[], prefix = "") => (await emb.createTextEmbeddings({ texts: texts.map((t) => prefix + t), model: EmbeddingModel.Nomicembedtext })).embeddings.map((e) => quantize(e.embedding));

try {
  await vdb.createCollection({ databaseId: DB, collectionId: COLL, name: COLL, dimension: 768, documentSecurity: true });
  await vdb.createIndex({ databaseId: DB, collectionId: COLL, key: "emb_cosine", type: VectorsDBIndexType.HnswCosine, attributes: ["embeddings"] });
  for (let i = 0; i < 30; i++) { const idx = await vdb.getIndex({ databaseId: DB, collectionId: COLL, key: "emb_cosine" }); if (idx.status === "available") break; await new Promise((r) => setTimeout(r, 1500)); }

  const texts = ["Ada is on the Pro plan, billed monthly.", "Ada prefers email over phone calls.", "Kestrel Foods paid invoice INV-204 on time.", "Ada reported that CSV exports drop the last row.", "Apollo staging runs in the Frankfurt region."];
  const vecs = await embed(texts, "search_document: ");
  for (let i = 0; i < texts.length; i++) {
    await vdb.createDocument({ databaseId: DB, collectionId: COLL, documentId: `m_testtest_${String(i).padStart(12, "0")}`, data: { embeddings: vecs[i], metadata: { space: i < 4 ? "testtest" : "othersp1", seq: String(i).padStart(12, "0"), text: texts[i], h: { kind: i === 1 ? "preference" : "fact" }, d: { contradictedBy: [] } } } });
  }
  const [qv] = await embed(["What plan is Ada on?"], "search_query: ");

  // 1. Vector query with and without metadata filters.
  try {
    const [plain, t1] = await ms(() => vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.vectorCosine("embeddings", qv), Query.limit(3)] }));
    const [filtered, t2] = await ms(() => vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.vectorCosine("embeddings", qv), Query.equal("metadata.space", ["othersp1"]), Query.limit(3)] }));
    const ok = filtered.documents.every((d) => (d as any).metadata.space === "othersp1");
    const dist = (plain.documents[0] as any).$distance;
    rec(1, "Vector query combined with metadata filters", ok, `plain ${t1} ms, filtered ${t2} ms; filter respected: ${ok}; $distance present: ${dist !== undefined} (top ${dist})`, ok ? "Keep ENGRAM_VECTOR_FILTERS=true" : "Set ENGRAM_VECTOR_FILTERS=false (over-fetch and filter in code)");
  } catch (e) { rec(1, "Vector query combined with metadata filters", false, err(e), "Set ENGRAM_VECTOR_FILTERS=false"); }

  // 2. createDocument with an existing ID.
  try {
    await vdb.createDocument({ databaseId: DB, collectionId: COLL, documentId: "m_testtest_000000000000", data: { embeddings: vecs[0], metadata: { space: "x" } } });
    rec(2, "createDocument with an existing ID", false, "second create SUCCEEDED (overwrote or duplicated)", "Chain lock is unsafe: switch to the head-document fallback (Document 3, section 2)");
  } catch (e) { rec(2, "createDocument with an existing ID", e instanceof AppwriteException && e.code === 409, err(e), "Engine maps 409 to ConflictError: lock-free chain is safe"); }

  // 3. Transaction staging a create whose ID is taken meanwhile.
  try {
    const tx = await vdb.createTransaction({ ttl: 60 });
    await vdb.createOperations({ transactionId: tx.$id, operations: [{ action: "create", databaseId: DB, collectionId: COLL, documentId: "m_testtest_000000000099", data: { embeddings: vecs[0], metadata: { space: "testtest", who: "tx" } } }] });
    await vdb.createDocument({ databaseId: DB, collectionId: COLL, documentId: "m_testtest_000000000099", data: { embeddings: vecs[0], metadata: { space: "testtest", who: "direct" } } });
    try { await vdb.updateTransaction({ transactionId: tx.$id, commit: true }); rec(3, "Transaction create with an ID taken meanwhile", false, "commit SUCCEEDED", "Engine already creates the entry first (outside the transaction): no change needed"); }
    catch (e) { rec(3, "Transaction create with an ID taken meanwhile", true, `commit failed: ${err(e)}`, "Either strategy is safe; engine uses create-first"); }
  } catch (e) { rec(3, "Transaction create with an ID taken meanwhile", null, `could not run: ${err(e)}`, "Engine uses create-first, so this does not block"); }

  // 4. Vector round trip and embHash.
  {
    const d = await vdb.getDocument({ databaseId: DB, collectionId: COLL, documentId: "m_testtest_000000000001" }) as any;
    const same = (await embHash(quantize(d.embeddings))) === (await embHash(vecs[1]));
    rec(4, "Vector round trip keeps embHash", same, same ? "identical after quantizing to 5 decimals" : "values changed beyond 5-decimal rounding", same ? "Deep mode is safe" : "Use coarser quantization (4 decimals) or skip deep mode in the demo");
  }

  // 5. Metadata size and ID length.
  {
    const out: string[] = [];
    for (const kb of [4, 32, 128]) {
      try { await vdb.createDocument({ databaseId: DB, collectionId: COLL, documentId: ID.unique(), data: { embeddings: vecs[2], metadata: { space: "size", blob: "x".repeat(kb * 1024) } } }); out.push(`${kb} KB ok`); }
      catch (e) { out.push(`${kb} KB failed (${err(e)})`); }
    }
    for (const len of [23, 36]) {
      try { await vdb.createDocument({ databaseId: DB, collectionId: COLL, documentId: "m_" + "a".repeat(len - 2), data: { embeddings: vecs[2], metadata: { space: "id" } } }); out.push(`ID ${len} chars ok`); }
      catch (e) { out.push(`ID ${len} chars failed (${err(e)})`); }
    }
    rec(5, "Metadata size and ID length", out.some((o) => o.startsWith("4 KB ok")) && out.includes("ID 23 chars ok"), out.join("; "), "Entries are ~2 KB with 23-character IDs");
  }

  // 6. Does an update replace the whole metadata object?
  {
    const id = ID.unique();
    await vdb.createDocument({ databaseId: DB, collectionId: COLL, documentId: id, data: { embeddings: vecs[3], metadata: { space: "upd", a: "1", b: "2" } } });
    await vdb.updateDocument({ databaseId: DB, collectionId: COLL, documentId: id, data: { metadata: { space: "upd", a: "3" } } });
    const d = await vdb.getDocument({ databaseId: DB, collectionId: COLL, documentId: id }) as any;
    rec(6, "Update replaces or merges metadata", null, d.metadata.b === undefined ? "replaces the whole object" : "merges keys", "Engine always writes the full metadata object, so either is safe");
  }

  // 7. Nested path filters and string comparisons; numbers rejected.
  {
    const out: string[] = [];
    try { const r = await vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.equal("metadata.h.kind", ["preference"]), Query.limit(5)] }); out.push(`metadata.h.kind filter: ${r.documents.length === 1 ? "works" : `${r.documents.length} hits`}`); } catch (e) { out.push(`nested filter failed (${err(e)})`); }
    try { const r = await vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.equal("metadata.space", ["testtest"]), Query.lessThan("metadata.seq", "000000000002"), Query.limit(10)] }); out.push(`zero-padded lessThan: ${r.documents.length === 2 ? "works" : `${r.documents.length} hits`}`); } catch (e) { out.push(`lessThan failed (${err(e)})`); }
    try { await vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.equal("metadata.seq", [1 as unknown as string])] }); out.push("numeric filter accepted"); } catch (e) { out.push(`numeric filter rejected (${e instanceof AppwriteException ? e.code : "?"})`); }
    try { const r = await vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.equal("metadata.space", ["testtest"]), Query.orderDesc("$id"), Query.limit(1)] }); out.push(`orderDesc($id) head: ${(r.documents[0] as any)?.$id}`); } catch (e) { out.push(`order by $id failed (${err(e)})`); }
    rec(7, "Nested filters, string comparison, ordering", !out.some((o) => o.includes("failed")), out.join("; "), "Engine filters on metadata.d.concept for concept members; top-level copies cover the rest");
  }

  // 8. Query.select on metadata.
  try { const r = await vdb.createQuery({ databaseId: DB, collectionId: COLL, queries: [Query.select(["$id", "metadata"]), Query.limit(1)] }); rec(8, "Query.select(['$id','metadata'])", true, `works; embeddings returned: ${(r.documents[0] as any).embeddings !== undefined}`, "Engine skips vectors when not needed"); }
  catch (e) { rec(8, "Query.select(['$id','metadata'])", false, err(e), "Engine detects this and falls back to whole documents automatically"); }

  // 9. Team preferences.
  try {
    const teams = new Teams(client);
    const tid = `exp_${Date.now().toString(36)}`;
    await teams.create({ teamId: tid, name: "engram experiment" });
    await teams.updatePrefs({ teamId: tid, prefs: { spaceKey: "testtest", neighbourDistance: 0.35, nested: { a: [1, 2] } } });
    const p = await teams.getPrefs({ teamId: tid }) as any;
    await teams.delete({ teamId: tid });
    rec(9, "Team preferences read and write", p.spaceKey === "testtest" && p.nested?.a?.length === 2, "nested JSON round-trips", "Space settings live in team preferences");
  } catch (e) { rec(9, "Team preferences read and write", false, err(e), "Needs teams.read/teams.write scopes on the key"); }

  // 10. Recall quality with and without nomic task prefixes.
  {
    const docs = texts.slice(0, 4);
    const queries: [string, number][] = [["What plan is Ada on?", 0], ["How should we contact Ada?", 1], ["Did Kestrel pay?", 2], ["Which export bug did Ada hit?", 3]];
    const score = async (dp: string, qp: string) => {
      const dv = await embed(docs, dp);
      let hits = 0;
      for (const [q, want] of queries) {
        const [v] = await embed([q], qp);
        const best = dv.map((d, i) => [cosine(v, d), i] as const).sort((a, b) => b[0] - a[0])[0][1];
        if (best === want) hits++;
      }
      return hits;
    };
    const withP = await score("search_document: ", "search_query: ");
    const without = await score("", "");
    rec(10, "Recall quality with and without nomic task prefixes", null, `top-1 hits: with prefixes ${withP}/4, without ${without}/4`, withP >= without ? "Keep ENGRAM_EMBED_PREFIXES=true" : "Set ENGRAM_EMBED_PREFIXES=false");
  }

  // 13. The engine's conditional write (stage in a transaction, re-read, commit) under a real race: of two
  // writers that read the same version, exactly one may land. Runs through the engine's own adapter.
  {
    // Runs in the real memories collection, so it uses the reserved test space (no team, no permissions) and is
    // deleted in `finally`.
    const b = createAppwriteBackend(getConfig());
    const id = entryId(TEST_SPACE, 900_000_000_000 + Math.floor(Math.random() * 1e9));
    try {
      await b.vectors.create("memories", id, { embeddings: vecs[0], metadata: { space: TEST_SPACE, n: "0" } }, []);
      const read = (await b.vectors.get<{ n: string }>("memories", id))!;
      const attempts = await Promise.allSettled([1, 2, 3].map((n) => b.vectors.update("memories", id, { metadata: { space: TEST_SPACE, n: String(n) } }, undefined, { ifUpdatedAt: read.$updatedAt })));
      const won = attempts.filter((a) => a.status === "fulfilled").length;
      const conflicts = attempts.filter((a) => a.status === "rejected" && isConflict(a.reason)).length;
      const stale = await b.vectors.update("memories", id, { metadata: { space: TEST_SPACE, n: "late" } }, undefined, { ifUpdatedAt: read.$updatedAt }).then(() => "landed", (e) => (isConflict(e) ? "rejected" : `error ${err(e)}`));
      const ok = won === 1 && conflicts === 2 && stale === "rejected";
      rec(13, "Conditional writes under a race (3 writers, same read)", ok, `${won} landed, ${conflicts} conflicts; a later stale write was ${stale}`, ok ? "Stale copies cannot overwrite newer data (erasures stay erased)" : "Conditional writes are not safe: add a monotonic rev field and compare it instead of $updatedAt");
    } catch (e) { rec(13, "Conditional writes under a race", false, err(e), "Investigate before relying on conditional writes"); }
    finally { await b.vectors.delete("memories", id).catch(() => undefined); }
  }

  // 14. Where transactions break, if they do: read back right away, after a pause, and stage through the
  // per-document transactionId parameter instead of createOperations.
  {
    const out: string[] = [];
    try {
      const tx = await vdb.createTransaction({ ttl: 120 });
      out.push(`created ${tx.$id} (${tx.status})`);
      out.push(`get now: ${await vdb.getTransaction({ transactionId: tx.$id }).then((t) => t.status, err)}`);
      await new Promise((r) => setTimeout(r, 2000));
      out.push(`get after 2 s: ${await vdb.getTransaction({ transactionId: tx.$id }).then((t) => t.status, err)}`);
      const listed = await vdb.listTransactions().then((l) => l.transactions.some((t) => t.$id === tx.$id), () => null);
      out.push(`listed: ${listed}`);
      out.push(`stage via updateDocument: ${await vdb.updateDocument({ databaseId: DB, collectionId: COLL, documentId: "m_testtest_000000000002", data: { metadata: { space: "testtest", staged: "yes" } }, transactionId: tx.$id }).then(() => "ok", err)}`);
      out.push(`commit: ${await vdb.updateTransaction({ transactionId: tx.$id, commit: true }).then((t) => t.status, err)}`);
    } catch (e) { out.push(`failed: ${err(e)}`); }
    rec(14, "Transactions: where they fail", null, out.join("; "), "Without working transactions the engine applies batches one conditional write at a time (see 13)");
  }
} finally {
  try { await vdb.deleteCollection({ databaseId: DB, collectionId: COLL }); } catch { /* ignore */ }
}

upsertSection("core", `## Core experiments

Run by \`pnpm experiments\` on ${new Date().toISOString()} against \`${endpoint}\`, database \`${DB}\`. Each item matches a VERIFY note in the build series; the engine has a fallback for every one. Items 11 and 12 (Realtime and Function events) are in the events section.

${table(rows)}`);
console.log("\nWrote the core section of docs/verified.md");
