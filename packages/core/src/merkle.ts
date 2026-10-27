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

/**
 * Compact range (RFC 6962 "frontier") of a tree over n leaves: the roots of the perfect subtrees given by the binary
 * decomposition of n, largest (leftmost) first, so popcount(n) hashes. It is enough to append leaves and recompute
 * the root without the earlier leaves: root(n) = node(f[0], node(f[1], ... node(f[k-2], f[k-1]))), which is exactly
 * the largest-power-of-two split merkleRoot uses (the leftmost subtree is the largest power of two below n).
 */
export async function frontierAppend(frontier: Uint8Array[], size: number, leaves: Uint8Array[]): Promise<Uint8Array[]> {
  // A frontier that does not match the size (a bad sidecar restore) must fail loudly here: the collapse loop
  // below would otherwise pop past the end and hash garbage into the root.
  if (frontier.length !== popcount(size)) throw new RangeError(`frontier has ${frontier.length} subtrees but a tree over ${size} leaves has ${popcount(size)}`);
  const out = [...frontier];
  let n = size;
  for (const leaf of leaves) {
    out.push(await leafHash(leaf));
    // Each trailing 1 bit of the old size is a perfect subtree of the same height as the one just completed.
    for (let m = n; m % 2 === 1; m = Math.floor(m / 2)) {
      const r = out.pop()!, l = out.pop()!;
      out.push(await nodeHash(l, r));
    }
    n++;
  }
  return out;
}

export async function frontierRoot(frontier: Uint8Array[]): Promise<Uint8Array> {
  if (!frontier.length) return sha256(new Uint8Array(0));
  let r = frontier[frontier.length - 1];
  for (let i = frontier.length - 2; i >= 0; i--) r = await nodeHash(frontier[i], r);
  return r;
}

/** Number of subtrees in the frontier of a tree over n leaves. */
export function popcount(n: number): number {
  let c = 0;
  for (let m = n; m > 0; m = Math.floor(m / 2)) c += m % 2;
  return c;
}

export const frontierAppendHex = async (frontier: string[], size: number, hexLeaves: string[]) =>
  (await frontierAppend(frontier.map(fromHex), size, hexLeaves.map(fromHex))).map(toHex);
export const frontierRootHex = async (frontier: string[]) => toHex(await frontierRoot(frontier.map(fromHex)));

/** Audit path for leaf i from precomputed leaf hashes, for callers that cache them across proofs. */
export async function proofFromLeafHashes(leafHashes: Uint8Array[], i: number): Promise<Uint8Array[]> {
  if (i < 0 || i >= leafHashes.length) throw new Error("index out of range");
  return proofOfHashes(leafHashes, i);
}
export const rootFromLeafHashes = (leafHashes: Uint8Array[]): Promise<Uint8Array> =>
  leafHashes.length ? rootOfHashes(leafHashes) : sha256(new Uint8Array(0));
