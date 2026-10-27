# Live verification results

Written by the provisioning steps against the live Appwrite project (see README, "Provisioning from the hosting build"). Each section is replaced only by the step that owns it.

<!-- engram:section core -->
## Core experiments

Run by `pnpm experiments` on 2026-10-25T08:28:04.389Z against `https://fra.cloud.appwrite.io/v1`, database `engram`. Each item matches a VERIFY note in the build series; the engine has a fallback for every one. Items 11 and 12 (Realtime and Function events) are in the events section.

| # | Item | Result | OK | What Engram does |
|---|------|--------|----|------------------|
| 1 | Vector query combined with metadata filters | plain 215 ms, filtered 200 ms; filter respected: true; $distance present: true (top 0.19054270230074066) | yes | Keep ENGRAM_VECTOR_FILTERS=true |
| 2 | createDocument with an existing ID | 409 document_already_exists: Document with the requested ID 'm_testtest_000000000000' already exists. Try again with a different ID or use ID.unique() to generate a unique ID. | yes | Engine maps 409 to ConflictError: lock-free chain is safe |
| 3 | Transaction create with an ID taken meanwhile | could not run: 404 transaction_not_found: Transaction with the requested ID '6addbd87cb2dc28cb7df' could not be found. | info | Engine uses create-first, so this does not block |
| 4 | Vector round trip keeps embHash | identical after quantizing to 5 decimals | yes | Deep mode is safe |
| 5 | Metadata size and ID length | 4 KB ok; 32 KB ok; 128 KB ok; ID 23 chars ok; ID 36 chars ok | yes | Entries are ~2 KB with 23-character IDs |
| 6 | Update replaces or merges metadata | replaces the whole object | info | Engine always writes the full metadata object, so either is safe |
| 7 | Nested filters, string comparison, ordering | metadata.h.kind filter: works; zero-padded lessThan: works; numeric filter rejected (400); orderDesc($id) head: m_testtest_000000000003 | yes | Engine filters on metadata.d.concept for concept members; top-level copies cover the rest |
| 8 | Query.select(['$id','metadata']) | works; embeddings returned: false | yes | Engine skips vectors when not needed |
| 9 | Team preferences read and write | nested JSON round-trips | yes | Space settings live in team preferences |
| 10 | Recall quality with and without nomic task prefixes | top-1 hits: with prefixes 4/4, without 4/4 | info | Keep ENGRAM_EMBED_PREFIXES=true |
| 13 | Conditional writes under a race (3 writers, same read) | 1 landed, 2 conflicts; a later stale write was rejected | yes | Stale copies cannot overwrite newer data (erasures stay erased) |
| 14 | Transactions: where they fail | created 6addbd90c2317a111427 (pending); get now: 404 transaction_not_found: Transaction with the requested ID '6addbd90c2317a111427' could not be found.; get after 2 s: 404 transaction_not_found: Transaction with the requested ID '6addbd90c2317a111427' could not be found.; listed: null; stage via updateDocument: 404 transaction_not_found: Transaction with the requested ID '6addbd90c2317a111427' could not be found.; commit: 404 transaction_not_found: Transaction with the requested ID '6addbd90c2317a111427' could not be found. | info | Without working transactions the engine applies batches one conditional write at a time (see 13) |
<!-- engram:end core -->

<!-- engram:section events -->
## Realtime and Function events

Run by the `events` step on 2026-10-26T20:24:30.988Z against `https://fra.cloud.appwrite.io/v1`, database `engram`, reserved test space `test0000`.
Verified channel for the live feed: **vectorsdb.engram.collections.memories.documents**. Function events that fired: **2 execution(s), namespace unknown (no x-appwrite-event header logged)**.

| # | Item | Result | OK | What Engram does |
|---|------|--------|----|------------------|
| 11 | Realtime channel for VectorsDB documents | fired: documents, vectorsdb.engram.collections.memories.documents, vectorsdb.engram.collections.memories.documents.m_test0000_900214980269; not fired: databases.engram.collections.memories.documents, databases.engram.collections.memories.documents.m_test0000_900214980269, tablesdb.engram.tables.memories.rows, rows; Appwrite reported channels documents, vectorsdb.engram.collections.memories.documents, vectorsdb.engram.collections.memories.documents.m_test0000_900214980269, documents.create, vectorsdb.engram.collections.memories.documents.create, vectorsdb.engram.collections.memories.documents.m_test0000_900214980269.create; events vectorsdb.engram.collections.memories.documents.m_test0000_900214980269.create, vectorsdb.engram.collections.memories.documents.m_test0000_900214980269, vectorsdb.engram.collections.memories, vectorsdb.engram | yes | Subscribe to vectorsdb.engram.collections.memories.documents (apps/web/lib/client/live.ts) |
| 12 | Function trigger on a VectorsDB document event | accepted names: databases.engram.collections.concepts.documents.*.create, databases.engram.collections.concepts.documents.*.update, vectorsdb.engram.collections.concepts.documents.*.create, vectorsdb.engram.collections.concepts.documents.*.update, databases.*.collections.*.documents.*.create, vectorsdb.*.collections.*.documents.*.create, databases.engram.collections.concepts.documents.*, vectorsdb.engram.collections.concepts.documents.*; rejected: none; fired: execution 6adfb6f909acf3aa59b4, no x-appwrite-event header logged [completed], execution 6adfb6f5ce19c006e6f4, no x-appwrite-event header logged [completed]; labeler events restored to databases.engram.collections.concepts.documents.*.update | info | Executions fired but Appwrite logged no x-appwrite-event header, so which namespace delivered them is unproven: keep both databases.* and vectorsdb.* in appwrite.json, and read the namespace off a labeler execution in the console |
<!-- engram:end events -->

<!-- engram:section appwrite-live -->
## Adapter integration suite (live)

Run by the `appwrite-live` step on 2026-10-26T20:39:26.580Z against `https://fra.cloud.appwrite.io/v1`, reserved test space `test0000`: 5/5 passed. Every test document and file is deleted afterwards.

| # | Item | Result | OK | What Engram does |
|---|------|--------|----|------------------|
| L1 | create-first: a second create with the same ID is a conflict and does not overwrite | passed in 992 ms | yes | Adapter integration (packages/server/test/appwrite-live.test.ts) |
| L2 | compare-and-swap: of three writers racing on one read, exactly one lands; a later stale write is rejected | passed in 1534 ms | yes | Adapter integration (packages/server/test/appwrite-live.test.ts) |
| L3 | a conditional bulk update that includes embeddings replaces the vector (the forget path) | passed in 1888 ms | yes | Adapter integration (packages/server/test/appwrite-live.test.ts) |
| L4 | a batch applied through transact() lands (transactions or the conditional fallback) | passed in 1346 ms | yes | Adapter integration (packages/server/test/appwrite-live.test.ts) |
| L5 | files: create-first with a duplicate file ID is a conflict; the prefix listing finds the file | passed in 797 ms | yes | Adapter integration (packages/server/test/appwrite-live.test.ts) |
<!-- engram:end appwrite-live -->

<!-- engram:section quality -->
## Quality fixtures

Run by the `quality` step on 2026-10-26T20:23:38.484Z. Fixtures: `scripts/fixtures/quality.ts`.

| Check | Setup | Score | Gate |
|-------|-------|-------|------|
| Relation accuracy (30 labelled pairs, 6 per relation) | anthropic:claude-haiku-5-5 (through relate()) | **25/30** (duplicate 6/6, supersedes 6/6, contradicts 1/6, refines 6/6, unrelated 6/6) | ≥ 22/30: pass |
| Recall hit rate @3 (15 queries, 40 memories) | Appwrite nomic-embed-text with task prefixes, cosine top-3 | **15/15** (top-1 15/15, MRR 1.000) | reported |

Misclassified: con-1 (expected contradicts, got supersedes); con-3 (expected contradicts, got supersedes); con-4 (expected contradicts, got supersedes); con-5 (expected contradicts, got supersedes); con-6 (expected contradicts, got supersedes).
<!-- engram:end quality -->
