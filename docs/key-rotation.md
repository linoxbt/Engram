# Checkpoint key rotation

Checkpoints are signed with an Ed25519 key. Every checkpoint names its key in `keyId`, and every verifier (the
browser, the sentinel, the signer, `/verify`, proofs) checks it with the public key listed under that ID in its
keyring. A checkpoint whose `keyId` is not in the keyring is a critical finding, and the signer refuses to extend a
checkpoint it cannot verify. So rotation is always: **publish the new public key everywhere first, keep every old
one, then switch the signer.**

## Variables

| Variable | Where | Value |
|---|---|---|
| `CP_PRIVATE_KEY` | checkpoint Function only (or the app when it signs inline) | private key, hex |
| `CP_KEY_ID` | app, checkpoint and sentinel Functions | ID of the current signing key, `engram-cp-YYYY-MM` |
| `CP_PUBLIC_KEYS` | app (server), checkpoint and sentinel Functions | every public key ever used: `keyId:hex,keyId:hex` |
| `NEXT_PUBLIC_CP_PUBLIC_KEYS` | app build (browser) | the same list; built into the verifier page |
| `NEXT_PUBLIC_CP_PUBLIC_KEY`, `NEXT_PUBLIC_CP_KEY_ID` | legacy | a single key; still read and listed under its ID |

`pnpm functions:deploy` passes `CP_PUBLIC_KEYS` (merged from `CP_PUBLIC_KEYS`, `NEXT_PUBLIC_CP_PUBLIC_KEYS` and the
legacy key) and `CP_KEY_ID` to the Functions. It never overwrites or deletes an existing `CP_PRIVATE_KEY`: it creates
one only when the checkpoint Function has none, and replaces it only with `--rotate-key` and a `CP_KEY_ID` that
differs from the current one. It refuses to deploy when the private key does not match the public key listed for
`CP_KEY_ID`, when a rotation would drop the old public key, or when a required variable is missing.

## Runbook

1. **Generate a pair.** `pnpm keygen` prints `CP_KEY_ID=engram-cp-YYYY-MM`, `CP_PRIVATE_KEY=...` and the public
   key. Keep the private key in a password manager; it goes nowhere else yet.
2. **Publish the new public key, keep the old one.** Append `newId:newPublicHex` to `CP_PUBLIC_KEYS` and to
   `NEXT_PUBLIC_CP_PUBLIC_KEYS` in every environment (Netlify, local `.env`, CI), leaving every existing entry in
   place. If the deployment still uses the legacy single key, first move it into the lists as
   `oldId:oldPublicHex` (its ID is the current `CP_KEY_ID`, by default `engram-cp-2026-10`).
3. **Redeploy the app and the Functions without changing the signer.** Rebuild the site (the browser keyring is
   fixed at build time) and run `pnpm functions:deploy` with `CP_KEY_ID` still set to the old ID. Check that the
   chain page and `/verify/<space>` still show every checkpoint valid.
4. **Rotate the signer.** Set `CP_KEY_ID=newId` and `CP_PRIVATE_KEY=<new private key>` in the environment you deploy
   from, then run `pnpm functions:deploy -- --rotate-key`. If the Function's current `CP_KEY_ID` is stored as a
   secret (older deployments), add `--current-key-id=<oldId>`. Update `CP_KEY_ID` in the app as well; if the app
   signs inline (no checkpoint Function), update its `CP_PRIVATE_KEY` at the same time.
5. **Verify.** The next checkpoint names `newId` and links to the last one signed with `oldId`. The sentinel's next
   run, the browser verifier and `GET /api/v1/verify` should all report the space valid.
6. **Never remove old public keys.** Checkpoints signed with them stay in Storage forever; removing a key turns each
   of them into a critical "unknown key" finding.

## If the private key leaked

Rotate as above immediately. Checkpoints signed before the leak stay valid, but anything signed with the leaked key
after the leak cannot be told apart from a forgery by the signature alone. The trust anchors still help: the newest
checkpoint the signer recorded (`latestCheckpoint` in the space's team preferences), GitHub anchors when anchoring is
on, and the newest checkpoint each browser remembers. Compare those with the stored checkpoints before trusting any
signed after the suspected leak.
