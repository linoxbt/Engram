# Engram

**Memory you can prove.** Verifiable, time-travelling memory for AI agents, built on Appwrite VectorsDB.

Agents connect over MCP and call `remember`, `recall` and `forget`. Every memory is stored by meaning, chained by hash and replayable in time. Engram finds contradictions as new facts arrive, answers what an agent knew on any past date, and proves with signed checkpoints that no memory was changed after it was written. Forgetting erases the content but keeps a cryptographic receipt, so the history still verifies.

> Built solo for the [Appwrite Databases Hackathon](https://hackathon.appwrite.io/), 19–31 October 2026. Database type: **VectorsDB**.

## The problem

Agents now remember things between sessions, but nobody can prove what an agent knew when it made a decision. Memory can be poisoned or edited without anyone noticing, and every later decision inherits the lie. Memory never reconciles itself: old and new facts both come back in recall, and "forget me" means either losing the audit trail or breaking the promise.

## What Engram does

| Promise | How |
|---------|-----|
| **Meaning-addressed** | Appwrite's built-in embeddings (nomic-embed-text, 768) and HNSW cosine search with metadata filters, re-ranked by similarity, recency, importance and use, diversified with MMR. |
| **Tamper-evident** | Every write extends a per-space hash chain. Signed Ed25519 Merkle checkpoints make any edit, deletion or reordering detectable. The verifier runs in the browser. |
| **Time-travelling** | Any recall can run as of a past moment and returns exactly what was valid then, from derived fields or by replaying the chain. |
| **Self-reconciling** | New facts are checked against close neighbours: duplicates are merged, superseded facts retired, real conflicts sent to a review inbox. Every resolution is a chain entry. |
| **Provably forgettable** | Forgetting removes the text, salt and vector but keeps the salted hash, so the chain still verifies and the erasure itself is recorded. |

## Connect in 60 seconds

1. Create an account and a space, then an agent key on the Agents page.
2. Add Engram to your MCP client:

```bash
claude mcp add --transport http engram https://<your-app>/api/mcp \
  --header "Authorization: Bearer eng_XXXX_..."
```

3. Ask your agent to remember something, start a new session, and ask about it.

Tools: `remember`, `recall`, `forget`, `timeline`, `verify`, `resolve`. REST API at `/api/v1` and a TypeScript SDK (`packages/sdk`). See `/docs` in the app.

## How it works

```
 Agents ── MCP / REST ──▶ Next.js (Netlify) ──▶ Appwrite: VectorsDB · Embeddings · Auth/Teams · Storage · Functions · Realtime
 Browser ◀── dashboard, verifier (WebCrypto), Tamper Lab, Time Machine
```

- **The chain.** Entry IDs encode their sequence number: `m_<space>_<seq as 12 digits>`, so ordering by `$id` is chain order. Each entry's header (op, kind, author, subject, salted content hash, vector hash, times, refs, previous hash) is hashed with SHA-256 over canonical JSON.
- **Lock-free writes.** Two writers that read the same head build the same ID. VectorsDB accepts one `createDocument`; the other gets a conflict and rebuilds on the new head. Derived updates on neighbours commit in one transaction and are idempotent.
- **Checkpoints.** A scheduled Appwrite Function builds an RFC 6962 Merkle tree over header hashes and signs it with a key the database never sees. Checkpoints link to each other and can be anchored to a public GitHub repository.
- **Verification.** Structure, links, header hashes, content hashes, vector hashes (deep mode), refs, time, a full derived-state replay, checkpoint signatures, linkage and roots. "Valid through #N", or the exact first broken entry.
- **Forgetting.** A forget entry is appended; the target's text, salt and vector are erased; its header stays, so the chain still verifies.
- **Tamper Lab.** In sandbox spaces, nine attackers with full database access corrupt the chain, each caught by a different layer, the last ones only by the signed checkpoint.

More: [architecture](docs/architecture.md) · [spec corrections](docs/spec-corrections.md) · [demo script](docs/demo-script.md) · [Day 1 verification](docs/verified.md).

## Appwrite features used

| Feature | Where |
|---------|-------|
| **VectorsDB** | All structured data: `memories` (768), `concepts` (768), `agents` (384), `recalls` (768), each with an HNSW cosine index |
| **Built-in embeddings** | nomic-embed-text for memories and queries; all-minilm for agent capability search |
| **Vector + metadata queries** | Recall filtered by space, status, kind, subject, agent and time; `createQuery` for 768-d vectors |
| **Unique document IDs** | The chain's concurrency lock |
| **Transactions** | Atomic derived updates on neighbours with conflict detection |
| **Document permissions** | `read(team:<space>)` on every document; agents collection is server-only |
| **Auth + Teams** | Dashboard sessions; one team per space; space settings in team preferences |
| **Storage** | Signed checkpoint files and exports |
| **Functions** | checkpoint (5 min), sentinel (15 min), labeler (concept events), reflect (daily) |
| **Realtime** | Live feed via a short-lived JWT, with 3-second polling as fallback |
| **Messaging** | Optional tamper alert emails from the sentinel |
| **Backups** | Daily backup policy on the `engram` database |

## Security model

- The checkpoint signing key lives only in the checkpoint Function. Verifiers need only the public key below and public header data.
- Agent keys are shown once; only a SHA-256 hash and a short prefix are stored. Keys are scoped and revocable, and every write carries the agent ID.
- The public verification routes return header fields and hashes, never memory text, and only for spaces that switch them on.
- Memory text is rendered as plain text only; recall output marks the author and source of each memory.
- Content hashes are salted, and the salt is deleted on forget, so an erased short fact cannot be recovered by guessing.

**Checkpoint public key:** set `NEXT_PUBLIC_CP_PUBLIC_KEY` on deployment and publish it here.

## Run it

```bash
pnpm install
cp .env.example .env.local        # leave APPWRITE_ENDPOINT empty for the local backend
pnpm keygen >> .env.local         # checkpoint keys
pnpm dev                          # http://localhost:3000
```

With no Appwrite variables, Engram runs on a local file-backed backend with a deterministic embedder and a rule-based classifier, so every screen works offline.

**On Appwrite:** `pnpm setup:appwrite`, then `pnpm experiments` (writes `docs/verified.md`), `pnpm functions:build` and deploy with the Appwrite CLI (`appwrite.json`), then `pnpm seed -- --owner you@example.com --public`. Deploy to Netlify (`netlify.toml` at the root builds `apps/web`) with the variables in `.env.example`; Netlify Scheduled Functions run the sentinel and checkpoint routes.

| Command | What it does |
|---------|--------------|
| `pnpm test` | Core and engine tests: hashes, Merkle proofs (sizes 1–70), every Tamper Lab attack, 20 parallel writers, supersede/conflict/forget/as-of, the seeded demo story |
| `pnpm e2e` | Playwright: sign up, sandbox, browser verification, recall, conflict resolution, Tamper Lab levels 1 and 4, public verifier |
| `pnpm typecheck` | All packages, scripts and Functions |
| `pnpm demo-agent smoke` | MCP smoke test with the official MCP client SDK (`ENGRAM_URL`, `ENGRAM_KEY`) |

## Tech stack and open-source libraries

| Library | Licence | Use |
|---------|---------|-----|
| Next.js, React | MIT | App, API routes, dashboard |
| node-appwrite, appwrite | BSD-3-Clause | Appwrite server and browser SDKs |
| @modelcontextprotocol/server, @modelcontextprotocol/client, mcp-handler | MIT | MCP server over Streamable HTTP; demo agent |
| @noble/ed25519 | MIT | Checkpoint signatures (same code in Node and browsers) |
| zod | MIT | Shared input schemas |
| ai, @ai-sdk/anthropic, @ai-sdk/openai | Apache-2.0 | Contradiction classifier, concept labels, reflect |
| @tanstack/react-query | MIT | Data fetching |
| d3-force | ISC | Concept map layout |
| Tailwind CSS | MIT | Styling with design tokens |
| clsx | MIT | Class names |
| Vitest, Playwright, esbuild, tsx, TypeScript | MIT / Apache-2.0 | Tests, bundling Functions, scripts |

## Limitations and roadmap

- The contradiction checker is only as good as its model; it can miss or over-flag, which is why the review inbox exists. Without a model key a rule-based classifier runs.
- Checkpoints rebuild the Merkle tree from entry 0; fine at demo scale, an incremental frontier is next.
- Truncation is detectable only up to the latest signed checkpoint.
- The demo history was seeded with past timestamps through an admin path; the seed says so.
- Only a TypeScript SDK today. Next: Python SDK, per-agent Ed25519 signatures on every write, signed audit exports ("what did the agent know at T"), a witness network co-signing checkpoints, self-hosting on Appwrite.

## Licence

BSD 2-Clause (see LICENSE). Built solo during the Appwrite Databases Hackathon, 19–31 October 2026. All code was written during the hackathon.
