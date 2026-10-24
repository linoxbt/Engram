/** RFC 6962 style Merkle tree over raw header hashes (32 bytes each). */
import { sha256 } from "./hash";
import { fromHex, toHex } from "./encode";

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const LEAF = new Uint8Array([0x00]);
const NODE = new Uint8Array([0x01]);
export const leafHash = (h: Uint8Array) => sha256(concat(LEAF, h));
export const nodeHash = (l: Uint8Array, r: Uint8Array) => sha256(concat(NODE, l, r));

/** Largest power of two strictly less than n (n >= 2). */
export function largestPow2Below(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export async function merkleRoot(leaves: Uint8Array[]): Promise<Uint8Array> {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  // Bottom-up over leaf hashes, same shape as the recursive RFC 6962 definition.
  return rootOfHashes(await Promise.all(leaves.map(leafHash)));
}

async function rootOfHashes(hs: Uint8Array[]): Promise<Uint8Array> {
  if (hs.length === 1) return hs[0];
  const k = largestPow2Below(hs.length);
  const [l, r] = await Promise.all([rootOfHashes(hs.slice(0, k)), rootOfHashes(hs.slice(k))]);
  return nodeHash(l, r);
}

/** Audit path for leaf i: sibling subtree roots from the leaf up. */
export async function merkleProof(leaves: Uint8Array[], i: number): Promise<Uint8Array[]> {
  if (i < 0 || i >= leaves.length) throw new Error("index out of range");
  const hs = await Promise.all(leaves.map(leafHash));
  return proofOfHashes(hs, i);
}

async function proofOfHashes(hs: Uint8Array[], i: number): Promise<Uint8Array[]> {
  if (hs.length === 1) return [];
  const k = largestPow2Below(hs.length);
  return i < k
    ? [...(await proofOfHashes(hs.slice(0, k), i)), await rootOfHashes(hs.slice(k))]
    : [...(await proofOfHashes(hs.slice(k), i - k)), await rootOfHashes(hs.slice(0, k))];
}

/**
 * Recompute the root from a leaf and its path. Mirrors merkleProof: the path
 * lists siblings bottom-up, so we first rebuild the descent choices top-down.
 */
export async function verifyMerkleProof(
  leaf: Uint8Array, index: number, size: number, path: Uint8Array[], root: Uint8Array,
): Promise<boolean> {
  if (index < 0 || index >= size) return false;
  const sides: ("L" | "R")[] = []; // side the sibling sits on, top-down
  let i = index, n = size;
  while (n > 1) {
    const k = largestPow2Below(n);
    if (i < k) { sides.push("R"); n = k; } else { sides.push("L"); i -= k; n -= k; }
  }
  if (sides.length !== path.length) return false;
  let h = await leafHash(leaf);
  for (let j = 0; j < path.length; j++) {
    const side = sides[sides.length - 1 - j];
    h = side === "R" ? await nodeHash(h, path[j]) : await nodeHash(path[j], h);
  }
  return toHex(h) === toHex(root);
}

export const rootHex = async (hexLeaves: string[]) => toHex(await merkleRoot(hexLeaves.map(fromHex)));
export async function proofHex(hexLeaves: string[], i: number): Promise<string[]> {
  return (await merkleProof(hexLeaves.map(fromHex), i)).map(toHex);
}
export const verifyProofHex = (leaf: string, index: number, size: number, path: string[], root: string) =>
  verifyMerkleProof(fromHex(leaf), index, size, path.map(fromHex), fromHex(root));
