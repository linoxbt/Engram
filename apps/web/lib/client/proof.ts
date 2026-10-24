"use client";
import { fromHex, largestPow2Below, leafHash, nodeHash, toHex, verifyCheckpointSig, type Checkpoint } from "@engram/core";

export interface ProofStep { label: string; hash: string; sibling: string | null; side: "L" | "R" | null }

/** Recompute an inclusion proof step by step (for the animation), then check the checkpoint signature. */
export async function walkProof(args: { leaf: string; index: number; size: number; path: string[]; checkpoint: Checkpoint; publicKey: string | null }) {
  const sides: ("L" | "R")[] = [];
  let i = args.index, n = args.size;
  while (n > 1) {
    const k = largestPow2Below(n);
    if (i < k) { sides.push("R"); n = k; } else { sides.push("L"); i -= k; n -= k; }
  }
  const steps: ProofStep[] = [];
  let h = await leafHash(fromHex(args.leaf));
  steps.push({ label: `Leaf #${args.index}`, hash: toHex(h), sibling: null, side: null });
  for (let j = 0; j < args.path.length; j++) {
    const side = sides[sides.length - 1 - j];
    const sib = fromHex(args.path[j]);
    h = side === "R" ? await nodeHash(h, sib) : await nodeHash(sib, h);
    steps.push({ label: `Level ${j + 1}`, hash: toHex(h), sibling: args.path[j], side });
  }
  const rootOk = sides.length === args.path.length && toHex(h) === args.checkpoint.root;
  const sigOk = args.publicKey ? await verifyCheckpointSig(args.checkpoint, args.publicKey) : null;
  return { steps, rootOk, sigOk };
}
