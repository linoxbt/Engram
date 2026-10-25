# Engram

**Memory you can prove.** Verifiable, time-travelling memory for AI agents, built on Appwrite VectorsDB.

Agents connect over MCP and call `remember`, `recall` and `forget`. Every memory is stored by meaning, chained by hash and replayable in time. Engram finds contradictions as new facts arrive, answers what an agent knew on any past date, and proves with signed checkpoints that no memory was changed after it was written. Forgetting erases the content but keeps a cryptographic receipt, so the history still verifies.

> Built solo for the [Appwrite Databases Hackathon](https://hackathon.appwrite.io/), 19–31 October 2026. Database type: **VectorsDB**.

**Live:** [engram-os.netlify.app](https://engram-os.netlify.app) · **Public verifier for the demo space, no login needed:** [engram-os.netlify.app/verify/e6gwreir](https://engram-os.netlify.app/verify/e6gwreir)

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
claude mcp add --transport http engram https://engram-os.netlify.app/api/mcp \
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
- **Lock-free writes.** Two writers that read the same head build the same ID. VectorsDB accepts one `createDocument`; the other gets a conflict and rebuilds on the new head. Derived updates on neighbours are idempotent and conditional on each document's `$updatedAt`: one transaction where VectorsDB transactions work, otherwise one compare-and-swap write at a time (`updateDocuments` filtered on `$id` and `$updatedAt`), which was verified live to let exactly one of three racing writers land.
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
| **Transactions** | Tried first for derived updates on neighbours; on this project they return `transaction_not_found` right after creation, so the adapter falls back to conditional bulk updates (see [verified](docs/verified.md) items 3, 13, 14) |
| **Document permissions** | `read(team:<space>)` on every document; agents collection is server-only |
| **Auth + Teams** | Email/password and passkey sign-in, email verification, password recovery; one team per space with `admin` and `member` roles, single-use invite links; space settings in team preferences |
| **Storage** | Signed checkpoint files and exports |
| **Functions** | checkpoint (5 min), sentinel (15 min), labeler (concept events), reflect (daily) |
| **Realtime** | Live feed via a short-lived JWT, with 3-second polling as fallback |
| **Messaging** | Optional tamper alert emails from the sentinel |
| **Backups** | `pnpm setup:appwrite` creates a daily backup policy for the `engram` database where the plan allows it (and says so when it cannot); `pnpm backup` exports what database backups do not cover |

## Security model

- The checkpoint signing key lives only in the checkpoint Function. Verifiers need only the public key below and public header data.
- Agent keys are shown once; only a SHA-256 hash and a short prefix are stored. Keys are scoped and revocable, and every write carries the agent ID.
- The public verification routes return header fields and hashes, never memory text, and only for spaces that switch them on.
- Memory text is rendered as plain text only; recall output marks the author and source of each memory.
- Content hashes are salted, and the salt is deleted on forget, so an erased short fact cannot be recovered by guessing. Forgetting also scrubs concept summaries, derived reflections and recall logs that quoted the memory.
- The checkpoint Function verifies the chain before it signs, so it never certifies a rewritten history.
- The browser verifier pins the public key at build time and remembers the largest checkpoint it has seen per space; a later, shorter chain is reported as a rollback. Without a trusted key the result is a warning, never green.
- Sign-in is rate-limited per IP and locks an account for 15 minutes after 8 failures. Adding or removing a passkey, and deleting an account, need a recent sign-in or the password.
- Invite links are single-use, expire after 7 days, can be bound to an email, and only their SHA-256 hash is stored.

**Checkpoint public key** (`engram-cp-2026-10`, Ed25519):

```
ec0a9a63949ad6b798f2f85d802d33d11e5c1f3940fc670a205c96290664da71
```

## Run it

```bash
pnpm install
cp .env.example .env.local        # leave APPWRITE_ENDPOINT empty for the local backend
pnpm keygen >> .env.local         # checkpoint keys
pnpm dev                          # http://localhost:3000
```

With no Appwrite variables, Engram runs on a local file-backed backend with a deterministic embedder and a rule-based classifier, so every screen works offline.

**On Appwrite:** `pnpm setup:appwrite`, then `pnpm experiments` (writes `docs/verified.md`), `pnpm functions:deploy` (builds and deploys the Functions from `appwrite.json`, with the signing key as a Function secret), then `pnpm seed -- --owner you@example.com --public`. Deploy to Netlify (`netlify.toml` at the root builds `apps/web`) with the variables in `.env.example`; `pnpm functions:deploy` deploys the Appwrite Functions that sign checkpoints and run the sentinel.

**Provisioning from the hosting build.** So the Appwrite key never leaves the host, the same steps can run inside the Netlify build, in the **production context only** (deploy previews and branch deploys never run it; `scripts/provision.ts` checks `CONTEXT` too and logs why it skipped):

1. Once, on your machine: `pnpm decrypt-report --keygen ~/.engram/report.key`. It writes the private key and prints `ENGRAM_REPORT_PUBKEY=...`.
2. In Netlify (production scope): `ENGRAM_REPORT_PUBKEY=<printed value>`, `ENGRAM_PROVISION=<16–64 chars of a-z0-9>` and optionally `ENGRAM_PROVISION_STEPS`. Default steps: `diagnose,setup,experiments,functions,seed`. Optional: `appwrite-live` (adapter integration suite against a reserved test space), `quality` (classifier and recall fixtures), `events` (Realtime channel and Function event discovery); `all` runs every step. The run is capped at `ENGRAM_PROVISION_BUDGET_MIN` (default 22) minutes.
3. Deploy, then `pnpm decrypt-report ~/.engram/report.key https://<site>/_provision/<id>.enc.json`. The report is redacted and encrypted to your key; without `ENGRAM_REPORT_PUBKEY` no report file is written and only a summary appears in the build log. Copy `verifiedMd` from the report into `docs/verified.md`.

`ENGRAM_DEMO_RESET=<same id>` re-seeds the demo space once. Remove `ENGRAM_PROVISION` afterwards; without it the step does nothing.

The labeler's event trigger in `appwrite.json` (`databases.engram.collections.concepts.documents.*.create`) names the database, so keep `APPWRITE_DB_ID=engram` (the default) or change that event path to match; otherwise the labeler never fires and a new concept keeps its rule-based label until the app relabels it at 3 members.

**Backups and restore.** Appwrite's database backup covers the VectorsDB collections only. Space settings live in team preferences and signed checkpoints in Storage, so export those too: `pnpm backup` writes every space team (name, preferences, members) and every file in the checkpoints bucket to `~/engram-backups/` (keep the file private). To restore after a loss:

1. Restore the database from its backup in the Appwrite console (Databases → `engram` → Backups → Restore), into the same database ID.
2. `pnpm backup -- --restore <file> --dry-run`, then without `--dry-run`. Missing teams are recreated with their preferences and missing files with their original IDs and permissions. Existing spaces and files are left alone, so a newer `latestCheckpoint` is never moved backwards. Members are listed, not re-created: re-invite them.
3. Verify every restored space (Chain page, or the sentinel's next run). A checkpoint newer than the restored database shows up as truncation, which is the honest answer: entries written after the backup are gone.

| Command | What it does |
|---------|--------------|
| `pnpm test` | Core and engine tests: hashes, Merkle proofs (sizes 1–70), every Tamper Lab attack, 20 parallel writers, supersede/conflict/forget/as-of, the seeded demo story |
| `pnpm e2e` | Playwright: cookie consent, sign up, sandbox, browser verification, recall, conflict resolution, Tamper Lab levels 1 and 4, public verifier, password reset, passkeys (virtual authenticator), invites |
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
| @simplewebauthn/server, @simplewebauthn/browser | MIT | Passkeys (WebAuthn) in the local backend and the browser |
| server-only | MIT | Keeps server modules out of client bundles |
| @netlify/plugin-nextjs | MIT | Next.js runtime on Netlify |
| Vitest, Playwright, esbuild, tsx, TypeScript | MIT / Apache-2.0 | Tests, bundling Functions, scripts |

## Limitations and roadmap

- The contradiction checker is only as good as its model; it can miss or over-flag, which is why the review inbox exists. Without a model key a rule-based classifier runs.
- Checkpoints rebuild the Merkle tree from entry 0; fine at demo scale, an incremental frontier is next.
- Truncation is detectable only up to the latest signed checkpoint.
- The demo history was seeded with past timestamps through an admin path; the seed says so. Seeding runs in short resumable slices, so a sandbox fills in over a few requests.
- VectorsDB transactions did not work on this project during the hackathon; conditional writes keep every derived update safe, but a multi-document change is applied one document at a time (each one idempotent and re-applied by the next writer if an instance dies).
- Only a TypeScript SDK today. Next: Python SDK, per-agent Ed25519 signatures on every write, signed audit exports ("what did the agent know at T"), a witness network co-signing checkpoints, self-hosting on Appwrite.

## Licence

BSD 2-Clause (see LICENSE). Built solo during the Appwrite Databases Hackathon, 19–31 October 2026. All code was written during the hackathon.
