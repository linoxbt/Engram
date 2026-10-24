# Architecture

```
 Agents                               Engram (Next.js on Netlify)                Appwrite Cloud
 ┌────────────────────────┐  HTTPS    ┌───────────────────────────────┐        ┌──────────────────────────────────┐
 │ Claude Code / Desktop  │──────────▶│ /api/mcp   MCP, Streamable HTTP│        │ Auth      users; teams = spaces  │
 │ Scripted demo agent    │  bearer   │ /api/v1/*  REST + public verify│        │ Embeddings nomic-embed-text (768)│
 │ Any MCP client or SDK  │ agent key │                                │───────▶│            all-minilm (384)      │
 └────────────────────────┘           │ @engram/server                 │        │ VectorsDB "engram"               │
                                      │  write path   lock-free chain  │        │   memories  768 hnsw_cosine      │
 Browser (people)                     │  recall       RRF, rerank, MMR │        │   concepts  768 hnsw_cosine      │
 ┌────────────────────────┐           │  relate       contradictions   │        │   agents    384 hnsw_cosine      │
 │ Dashboard              │◀──────────│  forget/link  receipts         │        │   recalls   768 hnsw_cosine      │
 │ Verifier (WebCrypto)   │◀─ Realtime (JWT) or 3 s polling ───────────────────│ Storage   checkpoints/, exports/ │
 │ Tamper Lab, Time Mach. │           │ @engram/core (also in browser) │        │ Functions checkpoint, sentinel,  │
 └────────────────────────┘           └───────────────────────────────┘        │           labeler, reflect       │
                                                                               │ Messaging tamper alerts          │
 Small model (classify, label, reflect) ◀── server only                        └──────────────────────────────────┘
 Public GitHub repo ◀── checkpoint roots (optional anchor)
```

## Packages

| Package | Role |
|---------|------|
| `packages/core` | Isomorphic integrity code: canonical JSON, the four hashes, Merkle trees, checkpoints, the shared derived-state reducer, the verifier, rerank and MMR, Tamper Lab attacks. Runs in Node 20+ and browsers with WebCrypto. The single implementation; a second copy would drift. |
| `packages/server` | The engine and storage adapters. `Backend` interfaces with an Appwrite implementation (VectorsDB, Embeddings, Teams, Storage, Account, Functions, Messaging) and a local file-backed implementation used by tests and offline development. |
| `packages/sdk` | `engram-sdk`, a typed REST client that checks proofs locally. |
| `apps/web` | Next.js App Router: MCP route, REST v1, dashboard API, every screen, public verifier, docs. |
| `functions/*` | Appwrite Functions bundled with esbuild: checkpoint (5 min), sentinel (15 min), labeler (event), reflect (daily). |
| `scripts/*` | `setup.ts` provisioning, `seed.ts` demo story, `experiments.ts` Day 1 checks, `demo-agent.ts` MCP client, `keygen.ts`, `build-functions.ts`. |

## The six flows

1. **Remember.** Validate, check idempotency and the rate limit, embed (`search_document:` prefix), search the 5 nearest active memories, classify relations (fast paths, then one structured model call with a 3 s budget, never blocking), then append: read the head, build the header with `seq = head + 1` and `prevHash = head.hash`, compute the salted content hash, vector hash and header hash, and `createDocument` with the sequence-encoded ID. A duplicate ID means another writer won: back off 20–80 ms and rebuild on the new head (8 attempts). Neighbour derived fields then commit in one transaction. After responding (`after()`): concept assignment, agent stats, a checkpoint trigger every N entries, and a background re-classification if the model timed out.
2. **Recall.** Embed the query (cached 10 min), vector leg with filters (limit 40), keyword leg for names, IDs and quoted phrases, Reciprocal Rank Fusion, score `0.62·sim + 0.18·recency + 0.12·importance + 0.08·use + 0.15·rrf − 0.10·conflict`, MMR (λ 0.7), conflict partners added, provenance from the latest checkpoint, logged to `recalls`.
3. **Forget.** Append a forget entry, then erase the target's text, salt and vector in a transaction. The header and hash stay untouched, so the chain verifies.
4. **Checkpoint.** Page through header hashes, build an RFC 6962 Merkle root, sign `canonical(checkpoint)` with Ed25519, store `cp_<space>_<seq>.json`, optionally anchor the previous root on GitHub.
5. **Verify.** Structure, links, header, content, vector (deep), refs and time, derived replay, checkpoint signatures, chain linkage and roots. Reports "valid through #N" or the first broken entry. Runs in the browser, in the sentinel and behind the `verify` tool.
6. **Time travel.** Candidates created at or before T, kept if still valid at T (derived fields), or replayed from entry 0 in authoritative mode. Erased memories appear as receipts.

## Data model

See Document 2 and [spec corrections](spec-corrections.md). Every filterable value is a string: 12-digit sequence numbers, 24-character ISO timestamps, 2-digit scores, 8-digit counts, `"true"`/`"false"`. Entry IDs are `m_<space>_<seq12>` so ordering by `$id` is chain order. Metadata has three groups: `h` (hashed, immutable), `c` (erasable content), `d` (derived), plus top-level copies for shallow filters.
