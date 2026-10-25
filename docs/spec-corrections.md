# Spec corrections

The five build documents (Product and Architecture, Data Model and VectorsDB, Backend Engineering, MCP Server SDK and Frontend, Build Plan and Launch) were followed closely. These are the places where the implementation deliberately departs from them, and why. Each one is covered by a test.

| # | Document says | Problem | Implementation |
|---|---------------|---------|----------------|
| 1 | Checkpoint file has `"v": 1` and `"size": 64` and is signed over `canonical()` | `canonical()` rejects numbers by design, so the checkpoint could not be signed | Every checkpoint field is a string (`"v": "1"`, `"size": "00000064"`). `packages/core/src/checkpoint.ts` |
| 2 | `sig` covers all fields "above"; `anchor` is outside the signature | An unsigned anchor can be swapped without detection | The optional GitHub anchor is part of the signed payload. It records the commit that published an *earlier* checkpoint's root (`anchoredSeq`) |
| 3 | Rule 5: a text-less memory must be targeted by an "earlier-or-equal" forget entry | Refs only point backwards (rule 7), so a forget entry always has a *larger* seq than its target. The rule as written can never be satisfied | A memory without text must be targeted by a forget entry anywhere later in the chain. `packages/core/src/verify.ts` |
| 4 | Rule 6 skips the vector check whenever the vector is the tombstone | An attacker could blank an active memory's vector to hide it from recall, undetected | A tombstone vector is only allowed on forget/link entries and on forgotten memories (deep mode). A forgotten memory whose vector is still stored is a warning |
| 5 | Forget entry: "contentHash = hash of the reason with a fresh salt", but the entry-type table says forget entries have no text | Ambiguous: is the reason stored? If so it can leak the erased content | The reason is stored in the forget entry's erasable `c.text` (max 200 chars) and checked by rule 4. The API and UI tell callers not to repeat the erased content |
| 6 | Idempotency looks up `metadata.idem`, which the document shape does not list | Missing field | `idem` is a top-level, unhashed metadata field |
| 7 | API key scopes differ between documents (functions vs teams) | The checkpoint Function reads and writes team preferences | Function scopes live in one place, `appwrite.json` (teams included), applied by `pnpm functions:deploy`; the server key's scopes are listed on the app's Deploy docs page (`/docs/deploy`), including `executions.write` to trigger checkpoints and `executions.read` for the health check |
| 8 | Example space key `k7m2q9xa` is described as base32 | `9` is not a base32 character, so ID validation built from the description would reject the documented example | Space keys are 8 characters of `[a-z0-9]`; new keys are generated from the base32 alphabet |
| 9 | Rule 8 tolerates 2 s of clock skew | Tolerance alone still allows timestamps to run backwards | The write path sets `createdAt = max(now, head.createdAt)`, so time never decreases; the verifier keeps the 2 s tolerance for older data |
| 10 | Recall formula lists a 0.10 conflict penalty but does not apply it | Omitted from the score | Applied: memories with an open conflict still appear, flagged, with score − 0.10 |
| 11 | `d.forgottenAt` and `d.relateStatus` are used but not in the document shape | Missing fields | Added to `Derived`, together with `forgottenBy` |
| 12 | Open conflicts filtered with `isNotNull("metadata.d.contradictedBy")` | An empty array is not null, so every memory would match | A top-level `conflict: "true" \| "false"` copy, derived from `contradictedBy` |
| 13 | Link entry kinds are not defined beyond "relation" | Resolutions need distinct semantics | Link kinds: `supersede` (one side wins), `refine` (both true), `dismiss` (not a conflict), `contradict` (a conflict found later by the background classifier). One reducer (`applyEntry`) defines their effect for both the write path and the verifier |
| 14 | Truncation of "the last 3 entries" is caught by the checkpoint | Only entries covered by a signed checkpoint can be protected; anything after the latest checkpoint can be truncated silently | Documented; sandboxes sign every 4 entries and the Tamper Lab reset seals the head, so the demo attacks always target covered entries |
| 15 | Concurrency: stage the create inside the transaction | Whether a staged create fails at commit when its ID was taken meanwhile is unverified | The entry is created first with `createDocument` (a duplicate ID fails: the lock), then neighbour updates are applied: in one transaction where VectorsDB transactions work, otherwise (this project, see 24) one conditional compare-and-swap write at a time. Derived updates are idempotent and recomputable, so a retry is always safe |
| 16 | Forgotten memories are returned by as-of recall | Their vectors are erased too, so they cannot be found by meaning | As-of recall surfaces them as erasure receipts by subject; the timeline and chain always show them |
| 17 | Recall returns the top k | An agent told to "mention conflicts" may receive only one side | Open-conflict partners of returned memories are always included, placed together |

## Found in review (after the first end-to-end run)

| # | Problem | Implementation |
|---|---------|----------------|
| 18 | Derived writes read the whole document and wrote it back unconditionally. A stale copy (an access-count bump, a supersede racing a forget) could restore erased text and salt, and the verifier would then report tampering on a legitimate chain | Every derived write is conditional on the document's `$updatedAt` at read time (`ifUpdatedAt`). In Appwrite the operations are staged, re-read and compared, and the commit-time conflict check covers the rest. Conflicts retry |
| 19 | A new entry's own derived state was computed from neighbours read before the create; if an earlier entry's neighbour updates had not landed (crashed instance), the new entry recorded a stale conflict forever | Entries carry `applied: "false"` until their neighbour updates have landed (marked last, after them; in the same batch where transactions work). Every writer first applies pending entries, oldest first ("helping"). This also guarantees a forget's erasure eventually lands |
| 20 | Overlapping checkpoint runs (async Function executions, cron plus post-commit triggers) could both link to the same predecessor, forking the checkpoint chain | A create-first lock file `cpl_<space>_<prevSeq>` allows one successor per checkpoint; a lock older than 5 minutes with no successor is reclaimed |
| 21 | Removing `d` from a document skipped the erasure and resurrection checks; a non-string header field crashed the verifier, leaving the sentinel's badge at its last value | Erasure rules run regardless of `d`; a missing `d` is its own finding. Headers are shape-checked before hashing and malformed ones become critical findings |
| 22 | `$distance` on VectorsDB results is unverified; without it neighbour detection would silently stop | If a vector result lacks `$distance`, the adapter computes cosine distance from the returned embedding |
| 23 | Checkpoint files were listed with full-text search | Listed with a `startsWith("name")` filter, falling back to search |

## Found live on Appwrite Cloud

| # | Problem | Implementation |
|---|---------|----------------|
| 24 | VectorsDB transactions return `transaction_not_found` immediately after `createTransaction` | The adapter tries a transaction, then falls back to compare-and-swap: `updateDocuments` filtered on `$id` and `$updatedAt`. Live check: of three writers racing on one read, exactly one lands |
| 25 | `getFileDownload` returned an empty body through the SDK, so checkpoints were listed but never loaded | Files are read with `getFileView`, and the bytes are normalised whatever shape the SDK returns |
| 26 | A scheduled Function execution has no body, and the runtime's `bodyJson` getter throws on it | Functions read `bodyText` first and treat an unparsable body as empty |
| 27 | Seeding a sandbox took minutes against a request timeout of seconds | Seeding is resumable: progress lives in the space settings and each request writes about 6 s of the story |

## Product and platform departures

| # | Document says | Why it changed | Implementation |
|---|---------------|----------------|----------------|
| 28 | Dark terminal look with cyan and gold accents | Contrast and legibility on long tables and chain views, and screenshots that read well on white slides | White monochrome theme: near-black text and accents on white, gold kept only for signatures and checkpoints (contrast ≥ 4.5:1), green/amber/red only for verification states. Tokens in `apps/web/app/globals.css` |
| 29 | Sign-in with email OTP or OAuth | OTP adds an email round trip to every sign-in, and OAuth providers need per-deployment app registration | Email and password with verification and recovery emails, plus passkeys (WebAuthn); sign-in is rate limited with a lockout after 8 failures |
| 30 | Deploy the app to Vercel | Hosting choice for the hackathon | Netlify (`netlify.toml`, `@netlify/plugin-nextjs`). Background work uses `after()` and Appwrite Functions, so nothing depends on Vercel-only features; provisioning runs only in Netlify's production context |
| 31 | `embHash` is a plain hash of the vector | Anyone holding the public header could embed a guessed text and compare vector hashes, defeating the content salt | Salted vector hashes (`engram:emb:v2:<salt>:`) for memories with a content salt; unsalted v1 remains for tombstones and older entries. The header version `h.v` was not bumped: the verifier picks v1 or v2 from the presence of the salt, so old and new entries verify side by side. `packages/core/src/hash.ts` |
| 32 | Every recall bumps the access count of every returned memory | One write per returned memory per recall turns reads into write storms and races with derived updates | Access bumps are throttled: at most 3 per recall, and a memory at most once every 10 minutes. Access is a ranking hint, not an audited counter. `packages/server/src/recall.ts` |
| 33 | Checkpoint files are world-readable (`read("any")`) so anyone can fetch them | Public files would expose every space's checkpoints, including spaces that have not switched public verification on | Checkpoint files carry `read(team:<space>)`; the public verifier gets them through `GET /api/v1/spaces/<key>/checkpoints`, served only for spaces with public verification on |
