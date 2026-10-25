# engram-sdk

Typed client for [Engram](../../README.md): verifiable, time-travelling memory for AI agents.

```ts
import { Engram } from "engram-sdk";

// publicKey: the checkpoint key you trust, from the operator's README or config, never from the server itself.
const mem = new Engram({ url: process.env.ENGRAM_URL!, key: process.env.ENGRAM_KEY!, publicKey: process.env.ENGRAM_CP_PUBLIC_KEY });
await mem.remember({ text: "Ada prefers email over phone calls.", subject: "customer:ada", kind: "preference" });
const { memories } = await mem.recall({ query: "How should we contact Ada?", k: 3 });
const then = await mem.recall({ query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00Z" });
const report = await mem.verify();
const ok = await mem.verifyProof(await mem.proof(memories[0].id)); // checked locally with WebCrypto
```

Retries 429 and 503 responses with backoff. `remember` sends an idempotency key (generated when you do not pass one), so its retries are safe; writes without one are only retried when the server says it did nothing. `verifyProof` is only `ok` when the signature checks out under a key you supplied.

`pnpm --filter engram-sdk build` writes the publishable package to `dist/` (ESM, Node 20+ or any modern browser): the verifier code from `@engram/core` is bundled in, and `@noble/ed25519` is the only runtime dependency. Inside this repository, tests and scripts import the source through path aliases, so no build is needed for them.
