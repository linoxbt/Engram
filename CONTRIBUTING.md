# Contributing

Engram was built solo for a hackathon; it is open to patches now that the entry is in.

## Getting it running

```bash
pnpm install
cp .env.example .env.local   # leave APPWRITE_ENDPOINT empty to use the local file-backed backend
ENGRAM_BACKEND=local pnpm dev
```

`.env.example` lists every variable the code reads; a test fails if a new one is left undocumented.

## Before you open a pull request

```bash
pnpm typecheck   # packages and their tests, scripts, Functions, e2e specs
pnpm lint        # bug rules only (see eslint.config.mjs)
pnpm test        # vitest
pnpm build       # only if you touched apps/web
pnpm e2e         # Playwright; PW_CHROMIUM_PATH reuses an installed Chromium
```

CI runs all of these.

## House rules

- `packages/core` is the single implementation of canonical JSON, the hashes, Merkle trees, checkpoints, the
  derived-state reducer and the verifier. The browser verifier and the server must hash identically, so never
  copy any of it — move it into `core` instead.
- The invariants in `CLAUDE.md` are not style preferences: every value in hashed data is a string, filterable
  metadata values are strings, `h`/`hash`/`sig` of a stored entry are never edited, `createdAt` never decreases,
  and public routes return headers and hashes but never `c.text`.
- Engine code talks to the `Backend` interfaces, never to Appwrite directly.
- Every behaviour change comes with a test that fails without it.
- Comments explain why, not what.
- Only primitives proven against the live project are used for concurrency; `docs/verified.md` is the record, and
  VectorsDB transactions are not among them.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md). Please do not open a public issue for one.
