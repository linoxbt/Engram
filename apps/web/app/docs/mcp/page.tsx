export default function McpDocs() {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-engram.app";
  return (
    <>
      <h1>MCP setup</h1>
      <p>Engram serves MCP over Streamable HTTP at <code>{url}/api/mcp</code>, statelessly. Every request carries an agent key: <code>Authorization: Bearer eng_XXXX_...</code>.</p>
      <h2>Claude Code</h2>
      <pre><code>{`claude mcp add --transport http engram ${url}/api/mcp \\
  --header "Authorization: Bearer eng_XXXX_..."`}</code></pre>
      <h2>Claude Desktop</h2>
      <p>Use a custom connector if your plan supports remote MCP servers with headers, or run a local bridge:</p>
      <pre><code>{`{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${url}/api/mcp", "--header", "Authorization: Bearer eng_XXXX_..."]
    }
  }
}`}</code></pre>
      <h2>MCP Inspector</h2>
      <pre><code>{`npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP · URL: ${url}/api/mcp
# Header: Authorization: Bearer eng_XXXX_...`}</code></pre>
      <h2>Tools</h2>
      <table><thead><tr><th>Tool</th><th>Input</th><th>Returns</th></tr></thead><tbody>
        <tr><td><code>remember</code></td><td>text, kind?, subject?, importance?, confidence?, source?, validFrom?, idempotencyKey?</td><td>id, seq, hash, status (created | duplicate), relations</td></tr>
        <tr><td><code>recall</code></td><td>query, k?, asOf?, kinds?, subject?, agent?, includeSuperseded?, verify?</td><td>memories with author, time, validity, conflicts and checkpoint</td></tr>
        <tr><td><code>forget</code></td><td>id, reason</td><td>forgetEntryId, seq, target, status</td></tr>
        <tr><td><code>timeline</code></td><td>subject, limit?</td><td>every entry about a subject, oldest first</td></tr>
        <tr><td><code>verify</code></td><td>id?, mode?</td><td>integrity status; with an id, an inclusion proof</td></tr>
        <tr><td><code>resolve</code></td><td>winnerId, loserId, action?, reason?</td><td>the link entry recording the decision</td></tr>
      </tbody></table>
      <p>Each tool returns <code>structuredContent</code> and a short text block written for a model, for example:</p>
      <pre><code>{`3 memories (as of now). 2 in conflict.
[#47 valid, conflicts with #49] Ada downgraded from Pro to Basic on 22 Oct. (support-agent, 22 Oct 11:15)
[#49 valid, conflicts with #47] Ada's account is on the Pro plan. (billing-agent, 22 Oct 15:40)
[#2 valid] Ada prefers email over phone calls. (onboarding-agent, 19 Oct 09:02)
Integrity: verified through #63, checkpoint cp_k7m2q9xa_000000000063 signed 27 Oct 11:05.`}</code></pre>
      <h2>Scripted agents</h2>
      <p>The repository includes <code>scripts/demo-agent.ts</code>, which drives the same tools with the official MCP client SDK, and a TypeScript SDK (<code>engram-sdk</code>) over the REST API.</p>
    </>
  );
}
