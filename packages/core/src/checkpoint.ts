/**
 * Signed checkpoints: "space S has N entries, head hash H, Merkle root R".
 *
 * Spec correction: every field is a string (v, size) so canonical() can sign
 * it, and the optional GitHub anchor is part of the signed payload.
 */
import * as ed from "@noble/ed25519";
import { canonical } from "./canonical";
import { checkpointId, count8, fromBase64, fromHex, iso, seqStr, toBase64, toHex } from "./encode";
import { sha256Hex } from "./hash";
import { rootHex } from "./merkle";
import type { Anchor, Checkpoint, UnsignedCheckpoint } from "./types";

const enc = new TextEncoder();

export function unsignedOf(cp: Checkpoint | UnsignedCheckpoint): UnsignedCheckpoint {
  const { v, space, seq, size, head, root, prevCheckpoint, prevCheckpointHash, createdAt, keyId, anchor } = cp;
  return { v, space, seq, size, head, root, prevCheckpoint, prevCheckpointHash, createdAt, keyId, anchor: anchor ?? null };
}

export const checkpointMessage = (cp: Checkpoint | UnsignedCheckpoint) => enc.encode(canonical(unsignedOf(cp)));
export const checkpointHash = (cp: Checkpoint) =>
  sha256Hex("engram:checkpoint:v1:" + canonical({ ...unsignedOf(cp), sig: cp.sig }));
export const checkpointFileId = (cp: Pick<UnsignedCheckpoint, "space" | "seq">) => checkpointId(cp.space, Number(cp.seq));

export async function buildCheckpoint(args: {
  space: string;
  /** Header hashes of entries 0..n-1, hex. */
  hashes?: string[];
  /** Instead of `hashes`: a tree the caller computed incrementally (size, last header hash, Merkle root). */
  tree?: { size: number; head: string; root: string };
  prev: Checkpoint | null;
  keyId: string;
  createdAt?: string;
  anchor?: Anchor | null;
}): Promise<UnsignedCheckpoint> {
  const hashes = args.hashes ?? [];
  const n = args.tree ? args.tree.size : hashes.length;
  if (n === 0) throw new Error("cannot checkpoint an empty chain");
  return {
    v: "1",
    space: args.space,
    seq: seqStr(n - 1),
    size: count8(n),
    head: args.tree ? args.tree.head : hashes[n - 1],
    root: args.tree ? args.tree.root : await rootHex(hashes),
    prevCheckpoint: args.prev ? checkpointFileId(args.prev) : null,
    prevCheckpointHash: args.prev ? await checkpointHash(args.prev) : null,
    createdAt: args.createdAt ?? iso(),
    keyId: args.keyId,
    anchor: args.anchor ?? null,
  };
}

export async function signCheckpoint(unsigned: UnsignedCheckpoint, privateKeyHex: string): Promise<Checkpoint> {
  const sig = await ed.signAsync(checkpointMessage(unsigned), fromHex(privateKeyHex));
  return { ...unsignedOf(unsigned), sig: toBase64(sig) };
}

export async function verifyCheckpointSig(cp: Checkpoint, publicKeyHex: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(fromBase64(cp.sig), checkpointMessage(cp), fromHex(publicKeyHex));
  } catch {
    return false;
  }
}

export async function generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const sk = ed.utils.randomSecretKey();
  return { privateKey: toHex(sk), publicKey: toHex(await ed.getPublicKeyAsync(sk)) };
}

export const publicKeyFromPrivate = async (privateKeyHex: string) =>
  toHex(await ed.getPublicKeyAsync(fromHex(privateKeyHex)));

export const cpSize = (cp: Pick<UnsignedCheckpoint, "size">) => Number(cp.size);
