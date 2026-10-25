export default function DeployDocs() {
  return (
    <>
      <h1>Deploy &amp; operate</h1>
      <h2>Appwrite</h2>
      <ol>
        <li>Create a project and an API key with the scopes: databases (read, write), vectorsdb (read, write, collections, documents, indexes), embeddings.write, files (read, write), buckets, teams (read, write), users.read, sessions.write, functions.read, executions.read (the health check reads the Functions&rsquo; latest runs), executions.write and, for alerts, messages.write. For <code>pnpm setup:appwrite</code> and provisioning also backups.read and backups.write, functions.write and users.write.</li>
        <li>Run <code>pnpm setup:appwrite</code>. It creates the VectorsDB database <code>engram</code>, the collections <code>memories</code> (768), <code>concepts</code> (768), <code>agents</code> (384) and <code>recalls</code> (768) with HNSW cosine indexes, the <code>checkpoints</code> bucket, and a daily backup policy for the database where the plan allows it (it says so when it cannot). Exports are streamed to the browser and never stored.</li>
        <li>Generate the checkpoint key pair with <code>pnpm keygen</code>. Put the private key only in the checkpoint Function; publish the public key.</li>
        <li>Build and deploy the Functions with <code>pnpm functions:deploy</code> (it reads <code>appwrite.json</code>). Schedules: checkpoint every 5 minutes, sentinel every 15 minutes (60 on the Free plan). The Functions call Appwrite with its dynamic API key, scoped by <code>appwrite.json</code>; they never receive your server key.</li>
        <li>Add your production and preview hostnames as web platforms and set a budget cap. Database backups do not cover team preferences or Storage: run <code>pnpm backup</code> as well (see the README for restore).</li>
      </ol>
      <h2>Netlify</h2>
      <p><code>netlify.toml</code> at the repository root builds <code>apps/web</code> on Netlify's Next.js runtime. Set the environment variables below with the Functions and Builds scopes, and redeploy after any change. Scheduling and signing run in Appwrite Functions (<code>pnpm functions:deploy</code>), so the signing key never reaches Netlify. The <code>/api/cron/*</code> routes remain for any external scheduler (they need <code>CRON_SECRET</code>). Keep the combined variables under Netlify's 4 KB function limit.</p>
      <div className="overflow-x-auto"><table><thead><tr><th>Variable</th><th>Where</th><th>Purpose</th></tr></thead><tbody>
        <tr><td>APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID</td><td>Netlify</td><td>Regional endpoint and project (Functions get them from Appwrite)</td></tr>
        <tr><td>APPWRITE_API_KEY</td><td>Netlify (secret)</td><td>Server key. Not given to the Functions, which use Appwrite&rsquo;s dynamic key</td></tr>
        <tr><td>APPWRITE_DB_ID</td><td>Netlify, Functions</td><td>Default <code>engram</code></td></tr>
        <tr><td>NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID, NEXT_PUBLIC_DB_ID</td><td>Netlify</td><td>Browser SDK and Realtime</td></tr>
        <tr><td>CP_PRIVATE_KEY</td><td>checkpoint Function only</td><td>Ed25519 signing key</td></tr>
        <tr><td>CP_KEY_ID, NEXT_PUBLIC_CP_KEY_ID, NEXT_PUBLIC_CP_PUBLIC_KEY</td><td>Netlify, Functions</td><td>The current signing key&rsquo;s ID and public key</td></tr>
        <tr><td>CP_PUBLIC_KEYS, NEXT_PUBLIC_CP_PUBLIC_KEYS</td><td>Netlify, Functions</td><td>Every public key ever used, as <code>keyId:hex,keyId:hex</code>, so older checkpoints stay verifiable after a rotation. The browser verifier pins the keys present at build time</td></tr>
        <tr><td>CHECKPOINT_FUNCTION_ID</td><td>Netlify</td><td>Lets the write path trigger a checkpoint</td></tr>
        <tr><td>CLASSIFIER_MODEL, MODEL_API_KEY</td><td>Netlify, Functions</td><td>For example <code>anthropic:claude-haiku-5-5</code></td></tr>
        <tr><td>GITHUB_ANCHOR_TOKEN, GITHUB_ANCHOR_REPO</td><td>checkpoint Function</td><td>Optional anchoring</td></tr>
        <tr><td>NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_DEMO_SPACE</td><td>Netlify</td><td>Public URL; the demo space linked from the landing page</td></tr>
        <tr><td>CRON_SECRET, SEED_ADMIN_TOKEN</td><td>Netlify</td><td>Cron routes; the seed route (delete after seeding)</td></tr>
        <tr><td>ENGRAM_PROVISION, ENGRAM_PROVISION_STEPS, ENGRAM_REPORT_PUBKEY</td><td>Netlify (production)</td><td>One-off provisioning inside the production build; the report is encrypted to the public key (see the README)</td></tr>
      </tbody></table></div>
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
        <li>Browser errors are written to the function logs as <code>[engram:client-error]</code> lines. Set <code>ERROR_WEBHOOK_URL</code> to a Slack or Discord incoming webhook to be alerted. Point an uptime monitor at <code>/api/v1/health</code>: it returns 503 with <code>status: "down"</code> when a dependency is down, and 200 with <code>ok: false, status: "degraded"</code> when the checkpoint signer or the sentinel has fallen behind. Anonymous calls are cached for 5 minutes and never call the model.</li>
        <li>Set <code>NEXT_PUBLIC_CONTACT_EMAIL</code> to the address shown on the Terms, Privacy and Cookie pages.</li>
      </ul>
    </>
  );
}
