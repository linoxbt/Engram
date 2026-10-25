# Demo script (2 minutes 30 seconds)

Record at 1080p, browser zoom 125 %, notifications off. One slide only.

## Before recording

1. The demo space is `e6gwreir` ("Northwind support", owner engramdb@gmail.com; set its password with "Forgot password"). Create a sandbox from the dashboard for the Tamper Lab part.
2. Connect Claude Code as support-agent: `claude mcp add --transport http engram https://engram-os.netlify.app/api/mcp --header "Authorization: Bearer <support-agent key>"`.
3. Open tabs: Claude Code, Overview, Conflicts, Time Machine, the sandbox Tamper Lab, the public verifier on a phone.
4. Record the live MCP part twice and keep the better take.

| Time | On screen | Voice-over |
|------|-----------|-----------|
| 0:00–0:12 | Claude Code asked "Ada emailed. What plan is she on and how should I reply?"; the answer with a conflict note | "This support agent just asked its memory what plan our customer is on. It got the right answer, and a warning that another agent disagrees." |
| 0:12–0:30 | Overview: live feed and chain strip; the "supersedes #N" chip | "Engram is memory for AI agents. Every memory is stored by meaning and linked into a hash chain. When a new fact arrives, Engram checks it against what it already knows." |
| 0:30–0:48 | Conflict inbox; click "A is right" on the Basic memory; "Recorded as entry #N" | "Here the billing agent still thinks Ada is on Pro. I settle it with one click, and the decision itself is written into the chain." |
| 0:48–1:10 | Time Machine: drag to Tuesday 20 October (Pro), then to now (Basic); press Prove it | "Now the question every team gets after an AI makes a mistake: what did it know at the time? On Tuesday, Pro. Today, Basic. And I can prove it." |
| 1:10–1:28 | Claude Code calls forget on the address; the drawer text dissolves; Verify stays green | "Ada asks us to delete her address. The content is gone for good, but the chain still verifies, because we keep a salted receipt of what was erased." |
| 1:28–2:05 | Tamper Lab: Edit the text (level 1), Edit and fix the entry's own hash (level 3), Rewrite all later history (level 4) | "Now an attacker with database access changes one memory to approve a ninety percent discount. The verifier finds the exact entry. A smarter attacker rewrites everything after it. The signed checkpoint catches that too." |
| 2:05–2:20 | One slide: Appwrite features used | "Engram runs on Appwrite VectorsDB: built-in embeddings, cosine search with metadata filters, unique IDs and conditional writes that make the chain safe without locks, document permissions, realtime, Functions that sign checkpoints, and backups." |
| 2:20–2:30 | Public verifier on a phone, then the logo | "Anyone can verify it, no login needed. Engram. Memory you can prove." |

## Judge questions

- **Isn't this just a vector database with extra steps?** Vector search is the part everybody has. The point is the hash chain with signed checkpoints: you can prove nothing was changed, ask what an agent knew on any past date, and erase a memory without breaking the record.
- **Two agents writing at once?** Each entry's ID is its sequence number. If two writers try to add #42 at the same moment, the database accepts one and the other retries as #43. No lock, no queue.
- **Rewriting the whole chain?** Signed checkpoints. A Function signs the Merkle root with a key that never touches the database, and can publish it to a public GitHub repository.
- **Forget but still intact?** The chain hashes a salted fingerprint of the text. Forgetting deletes the text, salt and vector and writes a forget entry. The salt is gone, so nobody can recover the text by guessing.
- **What doesn't work yet?** The contradiction checker is only as good as its model, which is why there is a review inbox. Verification rebuilds the tree each time, fine at demo scale. The demo history is seeded with past timestamps. Only a TypeScript SDK today.
