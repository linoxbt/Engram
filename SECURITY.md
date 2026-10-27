# Security policy

Engram's pitch is a security property — that memory cannot be changed after it was written without the change
being detectable — so a report that breaks it is the most useful thing anyone can send.

## Reporting a vulnerability

Email **engramdb@gmail.com** with `SECURITY` in the subject. Please do not open a public issue first.

Useful to include, in whatever detail you have:

- What breaks, and which of the claims in the README's "Security model" it breaks.
- The smallest reproduction you can manage: a space key on the live site, a `curl`, a test, or a diff against this
  repository. The local backend (`ENGRAM_BACKEND=local pnpm dev`) reproduces most of the engine without Appwrite.
- Whether it needs database access. The Tamper Lab assumes an attacker who already has it; attacks that only work
  with a valid owner session or an agent key are a different, and usually more serious, class.

This is a solo project built for a hackathon, not a staffed product. Expect a first reply within a week. There is
no bounty. You will be credited in the fix unless you ask not to be.

## Scope

In scope: this repository, and `engram-os.netlify.app`.

In scope and interesting:

- Anything that makes a chain verify after it was altered, or that makes verification report green when it should
  not: forged or replayed checkpoints, rollbacks the keyring or the browser's largest-seen check should catch,
  derived state the replay accepts.
- Recovering the text, salt or vector of a forgotten memory from anything Engram still stores or serves.
- Reading another space's data: public verification routes leaking `c.text`, team permissions, agent-key scoping,
  invite links, viewer access.
- Prompt injection from memory text that reaches a model as instructions rather than data.
- Secrets in output: the provisioning report, build logs, API error bodies, Function logs.

Out of scope: Appwrite Cloud and Netlify themselves (report those to their vendors), missing rate limits on
Appwrite's own account API (the project ID is public by necessity — see "Operator notes" in the README), denial of
service by volume, and the deliberate design choices listed as residual risks in the README.

## What this project already assumes

The threat model, the limits and the known residual risks are in the README under "Security model" and "Operator
notes". A report that lands inside something already documented there is still welcome — being written down does
not make it right.
