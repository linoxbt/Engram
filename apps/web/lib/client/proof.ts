"use client";
import { fromHex, largestPow2Below, leafHash, nodeHash, toHex, verifyCheckpointSig, verifyProofHex, type Checkpoint } from "@engram/core";
import { trustedKeyFor } from "./verify";

export interface ProofStep { label: string; hash: string; sibling: string | null; side: "L" | "R" | null }

/**
 * The signature verdict. `ok` is null when there was no key to check with. A signature checked with a key the
 * server handed over (`pinned: false`) or with a key that differs from the server's (`mismatch`) is a warning.
 */
export interface SigCheck { ok: boolean | null; pinned: boolean; mismatch: boolean; keyId: string }
export type SigState = "valid" | "invalid" | "unpinned" | "mismatch" | "unknown-key";

export function sigState(s: SigCheck): SigState {
  if (s.ok === false) return "invalid";
  if (s.ok == null) return "unknown-key";
  if (!s.pinned) return "unpinned";
  if (s.mismatch) return "mismatch";
  return "valid";
}

export const SIG_TEXT: Record<SigState, string> = {
  valid: "Signature valid (checked with the key built into this site).",
  invalid: "Signature INVALID.",
  unpinned: "Signature matches the key the server supplied, but this site has no built-in key, so it was not independently checked.",
  mismatch: "Signature valid with the built-in key, but the server offered a different key.",
  "unknown-key": "Signature not checked: no trusted key for this checkpoint's key ID.",
};

/** Checks a checkpoint signature with the key this site trusts for its keyId (see trustedKeyFor). */
export async function checkSignature(cp: Checkpoint, serverKey: string | null | undefined): Promise<SigCheck> {
  const t = trustedKeyFor(cp.keyId, serverKey);
  const ok = t.key ? await verifyCheckpointSig(cp, t.key) : null;
  return { ok, pinned: t.pinned, mismatch: t.mismatch, keyId: cp.keyId };
}

/** Intermediate hashes for the animation only. Whether the proof holds is decided by @engram/core. */
async function displaySteps(leaf: string, index: number, size: number, path: string[]): Promise<ProofStep[]> {
  const sides: ("L" | "R")[] = [];
  let i = index, n = size;
  while (n > 1) {
    const k = largestPow2Below(n);
    if (i < k) { sides.push("R"); n = k; } else { sides.push("L"); i -= k; n -= k; }
  }
  const steps: ProofStep[] = [];
  let h = await leafHash(fromHex(leaf));
  steps.push({ label: `Leaf #${index}`, hash: toHex(h), sibling: null, side: null });
  for (let j = 0; j < path.length; j++) {
    const side = sides[sides.length - 1 - j] ?? "L";
    const sib = fromHex(path[j]);
    h = side === "R" ? await nodeHash(h, sib) : await nodeHash(sib, h);
    steps.push({ label: `Level ${j + 1}`, hash: toHex(h), sibling: path[j], side });
  }
  return steps;
}

/** Recompute an inclusion proof against a signed checkpoint, then check the checkpoint signature. */
export async function walkProof(args: { leaf: string; index: number; path: string[]; checkpoint: Checkpoint; serverKey: string | null | undefined }) {
  const size = Number(args.checkpoint.size);
  const rootOk = await verifyProofHex(args.leaf, args.index, size, args.path, args.checkpoint.root).catch(() => false);
  const steps = await displaySteps(args.leaf, args.index, size, args.path).catch(() => [] as ProofStep[]);
  const sig = await checkSignature(args.checkpoint, args.serverKey);
  return { steps, rootOk, sig };
}

/** Per-step marks once the verdict is known: every step ticks when the root matches; otherwise the root step fails. */
export function stepMarks(count: number, rootOk: boolean | null): ("pending" | "ok" | "fail" | "neutral")[] {
  if (rootOk == null) return Array.from({ length: count }, () => "pending");
  if (rootOk) return Array.from({ length: count }, () => "ok");
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? "fail" : "neutral"));
}
