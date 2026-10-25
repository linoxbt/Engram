export default function ApiDocs() {
  return (
    <>
      <h1>REST API</h1>
      <p>Base path <code>/api/v1</code>. JSON in and out. Agent routes need <code>Authorization: Bearer eng_XXXX_...</code>. Errors look like <code>{`{ "error": { "code": "...", "message": "..." } }`}</code>.</p>
      <div className="overflow-x-auto"><table><thead><tr><th>Method and path</th><th>Scope</th><th>Purpose</th></tr></thead><tbody>
        <tr><td>POST /memories</td><td>remember</td><td>Remember (body: RememberInput)</td></tr>
        <tr><td>GET /memories/:id</td><td>recall</td><td>One entry with full metadata</td></tr>
        <tr><td>POST /recall</td><td>recall</td><td>Recall (body: RecallInput)</td></tr>
        <tr><td>POST /memories/:id/forget</td><td>forget</td><td>Forget, with an optional reason</td></tr>
        <tr><td>GET /subjects/:subject/timeline</td><td>recall</td><td>Timeline of a subject</td></tr>
        <tr><td>GET /verify?mode=standard|deep&amp;id=</td><td>verify</td><td>Integrity report, optionally with a proof</td></tr>
        <tr><td>GET /memories/:id/proof</td><td>verify</td><td>Inclusion proof against the latest checkpoint</td></tr>
        <tr><td>POST /conflicts/resolve</td><td>resolve</td><td>Resolve a conflict</td></tr>
        <tr><td>GET /me</td><td>any</td><td>The calling agent and its space</td></tr>
        <tr><td>GET /health</td><td>none</td><td>Database, embeddings and storage checks</td></tr>
        <tr><td>GET /spaces/:key</td><td>public</td><td>Name, public key, latest checkpoint</td></tr>
        <tr><td>GET /spaces/:key/chain?cursor=&amp;limit=</td><td>public</td><td>Header fields and hashes, paged</td></tr>
        <tr><td>GET /spaces/:key/checkpoints</td><td>public</td><td>Signed checkpoint files</td></tr>
        <tr><td>GET /spaces/:key/proof/:id</td><td>public</td><td>Inclusion proof, hashes only</td></tr>
      </tbody></table></div>
      <p>Public routes work only for spaces with public verification switched on, and never return memory text. They send open CORS headers.</p>
      <h2>Error codes</h2>
      <div className="overflow-x-auto"><table><thead><tr><th>Code</th><th>Status</th><th>When</th></tr></thead><tbody>
        <tr><td>bad_request</td><td>400</td><td>Validation failed</td></tr>
        <tr><td>unauthorized</td><td>401</td><td>Missing, unknown or revoked key</td></tr>
        <tr><td>forbidden</td><td>403</td><td>The key lacks the scope</td></tr>
        <tr><td>too_large</td><td>413</td><td>Text over 2,000 characters: split it into several memories</td></tr>
        <tr><td>rate_limited</td><td>429</td><td>More than 60 writes per agent per minute</td></tr>
        <tr><td>chain_busy</td><td>503</td><td>Contention beyond 8 retries: retry with the same idempotency key</td></tr>
        <tr><td>embeddings_unavailable</td><td>503</td><td>Embedding quota reached; nothing was written</td></tr>
      </tbody></table></div>
      <h2>SDK</h2>
      <pre><code>{`import { Engram } from "engram-sdk";
// publicKey: the checkpoint key you trust, never one the server hands you.
const mem = new Engram({ url: process.env.ENGRAM_URL!, key: process.env.ENGRAM_KEY!, publicKey: process.env.ENGRAM_CP_PUBLIC_KEY });
await mem.remember({ text: "Ada prefers email over phone calls.", subject: "customer:ada", kind: "preference" });
const { memories } = await mem.recall({ query: "How should we contact Ada?", k: 3 });
const then = await mem.recall({ query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00Z" });
const ok = await mem.verifyProof(await mem.proof(memories[0].id)); // checked locally`}</code></pre>
    </>
  );
}
