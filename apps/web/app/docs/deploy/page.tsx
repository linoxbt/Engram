export default function DeployDocs() {
  return (
    <>
      <h1>Deploy &amp; operate</h1>
      <h2>Appwrite</h2>
      <ol>
        <li>Create a project and an API key with the scopes: databases (read, write), vectorsdb (read, write, collections, documents, indexes), embeddings.write, files (read, write), buckets, teams (read, write), users.read, sessions.write, functions.read, executions.write and, for alerts, messages.write.</li>
        <li>Run <code>pnpm setup:appwrite</code>. It creates the VectorsDB database <code>engram</code>, the collections <code>memories</code> (768), <code>concepts</code> (768), <code>agents</code> (384) and <code>recalls</code> (768) with HNSW cosine indexes, and the <code>checkpoints</code> and <code>exports</code> buckets.</li>
        <li>Generate the checkpoint key pair with <code>pnpm keygen</code>. Put the private key only in the checkpoint Function; publish the public key.</li>
        <li>Build and deploy the Functions with <code>pnpm functions:build</code> and the Appwrite CLI. Schedules: checkpoint every 5 minutes, sentinel every 15 minutes.</li>
        <li>Add your production and preview hostnames as web platforms, configure a daily backup policy on the database, and set a budget cap.</li>
      </ol>
      <h2>Netlify</h2>
      <p><code>netlify.toml</code> at the repository root builds <code>apps/web</code> on Netlify's Next.js runtime. Set the environment variables below with the Functions and Builds scopes, and redeploy after any change. Scheduling and signing run in Appwrite Functions (<code>pnpm functions:deploy</code>), so the signing key never reaches Netlify. The <code>/api/cron/*</code> routes remain for any external scheduler (they need <code>CRON_SECRET</code>). Keep the combined variables under Netlify's 4 KB function limit.</p>
      <table><thead><tr><th>Variable</th><th>Where</th><th>Purpose</th></tr></thead><tbody>
        <tr><td>APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID</td><td>Netlify, Functions</td><td>Regional endpoint and project</td></tr>
        <tr><td>APPWRITE_API_KEY</td><td>Netlify (secret), Functions</td><td>Server key</td></tr>
        <tr><td>APPWRITE_DB_ID</td><td>Netlify, Functions</td><td>Default <code>engram</code></td></tr>
        <tr><td>NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID, NEXT_PUBLIC_DB_ID</td><td>Netlify</td><td>Browser SDK and Realtime</td></tr>
        <tr><td>CP_PRIVATE_KEY</td><td>checkpoint Function only</td><td>Ed25519 signing key</td></tr>
        <tr><td>NEXT_PUBLIC_CP_PUBLIC_KEY, CP_KEY_ID</td><td>Netlify, Functions</td><td>Shown to and used by verifiers</td></tr>
        <tr><td>CHECKPOINT_FUNCTION_ID</td><td>Netlify</td><td>Lets the write path trigger a checkpoint</td></tr>
        <tr><td>CLASSIFIER_MODEL, MODEL_API_KEY</td><td>Netlify, Functions</td><td>For example <code>anthropic:claude-haiku-5-5</code></td></tr>
        <tr><td>GITHUB_ANCHOR_TOKEN, GITHUB_ANCHOR_REPO</td><td>checkpoint Function</td><td>Optional anchoring</td></tr>
        <tr><td>NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_DEMO_SPACE</td><td>Netlify</td><td>Public URL; the demo space linked from the landing page</td></tr>
        <tr><td>CRON_SECRET, SEED_ADMIN_TOKEN</td><td>Netlify</td><td>Cron routes; the seed route (delete after seeding)</td></tr>
      </tbody></table>
      <h2>Local development</h2>
      <p>With no Appwrite variables, Engram runs on a local file-backed backend with a deterministic hashing embedder and a rule-based classifier, so every screen works offline: <code>ENGRAM_BACKEND=local pnpm dev</code>.</p>
      <h2>Operations</h2>
      <ul>
        <li>The sentinel re-verifies every space every 15 minutes and records the integrity badge; on new tampering it can email the owner through Appwrite Messaging (<code>ENGRAM_ALERT_EMAILS=true</code>).</li>
        <li>Retention, when set, is implemented as forget entries, never deletions, so the chain stays valid.</li>
        <li>Never re-embed in place: the vector hash would break. Create a new collection and copy, or mark a new model from a given sequence number onward.</li>
        <li>Rotate the server key after events where it may have been exposed. Rotating the checkpoint key means publishing the new public key and a new key ID; old checkpoints stay verifiable with the old key.</li>
      </ul>

      <h2>Accounts, email and operations</h2>
      <ul>
        <li>Verification and password-reset emails are sent by Appwrite. Add your site&rsquo;s hostname (for example <code>engram-os.netlify.app</code>) as a Web platform in the Appwrite console, or Appwrite will refuse the email links. <code>NEXT_PUBLIC_APP_URL</code> must match it.</li>
        <li>Signing in requires the visitor to accept cookies; the server rejects sign-in and sign-up without the <code>engram_consent=accepted</code> cookie.</li>
        <li>Sign-in, sign-up, password resets, verification emails and agent-key creation are rate limited per IP address, account or user.</li>
        <li>Browser errors are written to the function logs as <code>[engram:client-error]</code> lines. Set <code>ERROR_WEBHOOK_URL</code> to a Slack or Discord incoming webhook to be alerted. Point an uptime monitor at <code>/api/v1/health</code>, which returns 503 when a dependency is down.</li>
        <li>Set <code>NEXT_PUBLIC_CONTACT_EMAIL</code> to the address shown on the Terms, Privacy and Cookie pages.</li>
      </ul>
    </>
  );
}
