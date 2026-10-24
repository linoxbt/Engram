# Day 1 verification results

Not yet run against a live Appwrite project. Run `pnpm experiments` with `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID` and `APPWRITE_API_KEY` set; it overwrites this file with the results.

Each experiment maps to a VERIFY item in the build series, and the engine already has a fallback for every one:

| # | Item | Fallback if it fails |
|---|------|----------------------|
| 1 | Vector query combined with metadata filters | `ENGRAM_VECTOR_FILTERS=false`: over-fetch 200 by vector, filter in code |
| 2 | `createDocument` with an existing ID fails | Head-document fallback (Document 3, section 2) |
| 3 | Staged transaction create with a taken ID fails at commit | Not needed: entries are created first, outside the transaction |
| 4 | Vector round trip keeps `embHash` | Coarser quantization, or skip deep mode |
| 5 | Metadata size and ID length | Entries are about 2 KB; IDs are 23 characters |
| 6 | Update replaces or merges metadata | Engine always writes the whole metadata object |
| 7 | Nested filters, string comparison, ordering by `$id` | Top-level copies for shallow filters |
| 8 | `Query.select` | Detected at runtime; falls back to whole documents |
| 9 | Team preferences | Required for space settings |
| 10 | nomic task prefixes | `ENGRAM_EMBED_PREFIXES=false` |
| 11 | Realtime channel for VectorsDB | Polling every 3 s |
| 12 | Function trigger on VectorsDB events | Inline labelling after commit |
