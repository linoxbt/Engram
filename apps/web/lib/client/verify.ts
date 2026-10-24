"use client";
/**
 * In-browser verification: pages of entries stream through the same
 * ChainVerifier the server uses. Nothing here trusts the server: every hash,
 * Merkle root and signature is recomputed with WebCrypto.
 */
import { ChainVerifier, type ChainEntry, type Checkpoint, type PublicEntry, type Report, type VerifyMode } from "@engram/core";

export interface VerifyProgress { done: number; failedAt: number | null; results: Map<number, boolean> }

export async function runVerification(args: {
  space: string;
  mode: VerifyMode;
  publicKey?: string | null;
  fetchPage: (cursor: string | null) => Promise<{ entries: (ChainEntry | PublicEntry)[]; next: string | null }>;
  checkpoints: Checkpoint[];
  onProgress?: (p: VerifyProgress) => void;
  signal?: AbortSignal;
}): Promise<Report> {
  const v = new ChainVerifier({ space: args.space, mode: args.mode, publicKeyHex: args.publicKey ?? undefined });
  const results = new Map<number, boolean>();
  let failedAt: number | null = null;
  let cursor: string | null = null;
  for (;;) {
    if (args.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const page = await args.fetchPage(cursor);
    const res = await v.push(page.entries);
    for (const r of res) {
      results.set(r.seq, r.ok);
      if (!r.ok && failedAt == null) failedAt = r.seq;
    }
    args.onProgress?.({ done: results.size, failedAt, results });
    if (!page.next) break;
    cursor = page.next;
  }
  return v.finish(args.checkpoints);
}
