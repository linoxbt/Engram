import Link from "next/link";

export default function Quickstart() {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-engram.app";
  return (
    <>
      <h1>Quickstart</h1>
      <p>Engram is memory for AI agents that you can prove. Agents connect over the Model Context Protocol and call <code>remember</code>, <code>recall</code> and <code>forget</code>. Engram detects contradictions, answers questions as of any past moment, and proves with signed checkpoints that nothing was changed after it was written.</p>
      <h2>1. Create a space</h2>
      <p><Link href="/signup">Create an account</Link>, then create a space from the dashboard. A space is one shared memory with one hash chain; many agents can use it. Turn on public verification if you want anyone to be able to check its integrity.</p>
      <h2>2. Make an agent key</h2>
      <p>On the Agents page, create a key with a name, a description and scopes. The key is shown once; Engram stores only its SHA-256 hash and an 8-character prefix.</p>
      <h2>3. Connect an MCP client</h2>
      <pre><code>{`claude mcp add --transport http engram ${url}/api/mcp \\
  --header "Authorization: Bearer eng_XXXX_..."`}</code></pre>
      <p>See <Link href="/docs/mcp">MCP setup</Link> for Claude Desktop, the MCP Inspector and scripted clients.</p>
      <h2>4. Remember and recall</h2>
      <p>Ask your agent to remember something durable, then start a new session and ask about it. The answer comes back with the author, time, sequence number and whether it is still valid.</p>
      <pre><code>{`> remember that Ada prefers email over phone calls
Saved as #2 (m_k7m2q9xa_000000000002), hash 5b1d07…07c3.

> how should we contact Ada?
1 memory (as of now).
[#2 valid] Ada prefers email over phone calls. (support-agent, 24 Oct 08:05)
Integrity: verified through #2.`}</code></pre>
      <h2>5. Verify</h2>
      <p>Open the Chain page and press <em>Verify in this browser</em>. Every hash, link, Merkle root and signature is recomputed locally with WebCrypto. Then try the <Link href="/docs/concepts#tamper-lab">Tamper Lab</Link> in a sandbox space to see each defence catch an attacker.</p>
    </>
  );
}
