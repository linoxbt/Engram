# Engram: notes for contributors and coding agents

Verifiable, time-travelling memory for AI agents on Appwrite VectorsDB (hackathon entry, 19–31 Oct 2026, solo, VectorsDB). The original five-part build spec lives outside the repo; `docs/spec-corrections.md` lists every deliberate departure.

## Layout
- `packages/core`: isomorphic integrity code. **The single implementation** of canonical JSON, hashes, Merkle, checkpoints, the derived-state reducer (`applyEntry`), the verifier and Tamper Lab attacks. Never duplicate any of it: the browser verifier and the server must hash identically.
- `packages/server`: engine plus `Backend` adapters (`backend/appwrite.ts`, `backend/local.ts`). Engine code must only talk to the `Backend` interfaces.
- `packages/sdk`: REST client.
- `apps/web`: Next.js 16 App Router. `lib/server/api.ts` has the route wrappers (`agentRoute`, `spaceRoute`, `route`); post-commit work goes through `defer` (`after()`).
- `functions/*`: Appwrite Functions, bundled by `scripts/build-functions.ts`.

## Invariants
- Every value in hashed data is a string (canonical JSON throws on numbers). Filterable metadata values are strings too (VectorsDB requirement): 12-digit seq, 24-char ISO time, 2-digit scores, 8-digit counts, "true"/"false".
- Entry IDs: `m_<spaceKey>_<seq12>`. Append = create-first with the sequence ID (duplicate ID is the lock), then neighbour derived updates in a transaction via `updateNeighbours`.
- Never edit `h`, `hash` or `sig` of a stored entry. Changes are new entries (supersede, link, forget).
- `createdAt` never decreases.
- Public routes return headers and hashes only, never `c.text`.

## Commands
- `pnpm test` (vitest), `pnpm typecheck`, `pnpm build`, `pnpm e2e` (Playwright; set `PW_CHROMIUM_PATH` to use a preinstalled Chromium).
- Local dev without Appwrite: `ENGRAM_BACKEND=local pnpm dev`.
