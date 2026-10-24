export default function Concepts() {
  return (
    <>
      <h1>Concepts</h1>
      <p>Engram makes five promises: memories are found by meaning; every write is tamper-evident; any recall can run in the past; new facts reconcile themselves with old ones; and forgetting is provable.</p>
      <h2>Entries and the chain</h2>
      <p>Every record in a space is an <em>entry</em> with a sequence number. Its ID encodes that number, <code>m_&lt;space&gt;_&lt;seq as 12 digits&gt;</code>, so ordering by ID is chain order. An entry is one of four ops:</p>
      <table><thead><tr><th>Op</th><th>Holds</th><th>Effect</th></tr></thead><tbody>
        <tr><td><code>remember</code></td><td>text and an embedding</td><td>a new memory (fact, preference, event, observation)</td></tr>
        <tr><td><code>reflect</code></td><td>a model-written summary</td><td>a summary memory linked to its sources</td></tr>
        <tr><td><code>forget</code></td><td>a reason, a tombstone vector</td><td>the target's text, salt and vector are erased</td></tr>
        <tr><td><code>link</code></td><td>a reason, a tombstone vector</td><td>records a resolution: supersede, refine, dismiss, or a conflict found later</td></tr>
      </tbody></table>
      <h2>The four hashes</h2>
      <ul>
        <li><strong>genesis</strong>: <code>SHA-256("engram:genesis:v1:" + space)</code>, the previous hash of entry 0.</li>
        <li><strong>content hash</strong>: a salted hash of the text. Forgetting deletes the text and the salt and keeps this hash, so a short fact cannot be recovered by guessing.</li>
        <li><strong>vector hash</strong>: binds the exact embedding (rounded to 5 decimals), so a swapped vector is detected.</li>
        <li><strong>header hash</strong>: over the canonical form of every immutable field, including the previous entry's hash.</li>
      </ul>
      <p>Status, validity windows, conflicts and access counts are <em>derived</em>: they are recomputed by replaying the chain, and the verifier flags any disagreement.</p>
      <h2>Lock-free writes</h2>
      <p>Two writers that read the same head compute the same next ID. VectorsDB accepts only one create for that ID; the other gets a conflict and rebuilds on the new head. No queue, no lock document. Derived updates on neighbours then commit in one transaction, and they are idempotent, so a retry is always safe.</p>
      <h2>Checkpoints</h2>
      <p>A scheduled Function builds an RFC 6962 Merkle tree over the header hashes, signs the root, head and size with Ed25519, and stores the checkpoint as a file. Each checkpoint links to the previous one. Optionally the root is committed to a public GitHub repository, an outside timestamp the operator cannot rewrite. Inclusion proofs show that one memory is part of a signed checkpoint.</p>
      <h2>Contradictions</h2>
      <p>When a new memory is close to existing active ones, Engram classifies each pair as duplicate, supersedes, contradicts, refines or unrelated. Fast rules handle near-identical text and different subjects; a small model handles the rest; a write is never blocked on the model. Supersessions retire the old memory with a validity end. Real conflicts keep both memories active and land in the conflict inbox, where a decision is recorded as a link entry.</p>
      <h2>Time travel</h2>
      <p>An as-of recall keeps memories created at or before the chosen time that were still valid then. The fast path reads derived validity fields; the authoritative mode replays the chain from entry 0. Memories erased later are shown as receipts: the past is reconstructable except for what was deliberately erased, and the erasure is on record.</p>
      <h2 id="tamper-lab">Tamper Lab</h2>
      <p>In sandbox spaces, nine attackers corrupt the stored documents with full database access, each smarter than the last: editing text, fixing the content hash, fixing the entry hash, swapping entries, poisoning a vector, hiding a supersession, resurrecting erased data, truncating the chain, and rewriting all later history. Each is caught by a different layer, the last two only by the signed checkpoint.</p>
      <h2>Spec corrections</h2>
      <p>The implementation corrects a few issues in the original design documents: checkpoint fields are all strings so they can be signed canonically (and the GitHub anchor is signed too); a memory without text must be targeted by a <em>later</em> forget entry; a tombstone vector is allowed only on forget/link entries and forgotten memories; space keys allow digits; createdAt is forced to never decrease. See <code>docs/spec-corrections.md</code> in the repository.</p>
    </>
  );
}
