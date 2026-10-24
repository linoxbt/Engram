# engram-sdk

Typed client for [Engram](../../README.md): verifiable, time-travelling memory for AI agents.

```ts
import { Engram } from "engram-sdk";

const mem = new Engram({ url: process.env.ENGRAM_URL!, key: process.env.ENGRAM_KEY! });
await mem.remember({ text: "Ada prefers email over phone calls.", subject: "customer:ada", kind: "preference" });
const { memories } = await mem.recall({ query: "How should we contact Ada?", k: 3 });
const then = await mem.recall({ query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00Z" });
const report = await mem.verify();
const ok = await mem.verifyProof(await mem.proof(memories[0].id)); // checked locally with WebCrypto
```

Retries 429 and 503 responses with backoff. Use `idempotencyKey` on `remember` to make retries safe.
