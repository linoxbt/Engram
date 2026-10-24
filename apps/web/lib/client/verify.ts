"use client";
/**
 * In-browser verification: pages of entries stream through the same
 * ChainVerifier the server uses. Nothing here trusts the server: every hash,
 * Merkle root and signature is recomputed with WebCrypto.
 */
import { api } from "./api";
import { readConsent } from "./consent";
import { ChainVerifier, cpSize, type ChainEntry, type Checkpoint, type PublicEntry, type Report, type TrustedCheckpoint, type VerifyMode } from "@engram/core";

// Fixed when the site was built, so a tampered database or API response cannot swap the key the browser trusts.
const PINNED_KEY = process.env.NEXT_PUBLIC_CP_PUBLIC_KEY || null;

/**
 * The newest checkpoint this browser has seen valid for a space. A later visit must still find it covered, which
 * catches a server that rolls history back to an older, validly signed checkpoint. Stored only after cookie consent.
 */
const trustKey = (space: string) => `engram.trusted.${space}`;
function readTrusted(space: string): TrustedCheckpoint | undefined {
  try {
    const raw = localStorage.getItem(trustKey(space));
    const t = raw ? (JSON.parse(raw) as TrustedCheckpoint) : undefined;
    return t && Number.isSafeInteger(t.size) && typeof t.root === "string" ? t : undefined;
  } catch { return undefined; }
}
function writeTrusted(space: string, r: Report) {
  if (r.status === "tampered" || !r.latestCheckpoint || readConsent() !== "accepted") return;
  const prev = readTrusted(space);
  if (prev && prev.size >= r.latestCheckpoint.size) return;
  try { localStorage.setItem(trustKey(space), JSON.stringify({ size: r.latestCheckpoint.size, root: r.latestCheckpoint.root })); } catch { /* storage unavailable */ }
}

export interface VerifyProgress { done: number; failedAt: number | null; results: Map<number, boolean> }

export async function runVerification(args: {
  space: string;
  mode: VerifyMode;
  publicKey?: string | null;
  fetchPage: (cursor: string | null) => Promise<{ entries: (ChainEntry | PublicEntry)[]; next: string | null }>;
  checkpoints: Checkpoint[];
  onProgress?: (p: VerifyProgress) => void;
  signal?: AbortSignal;
  /** Rollback memory. Off for Tamper Lab sandboxes, whose history is rewritten and reset on purpose. */
  trust?: boolean;
}): Promise<Report> {
  const trust = args.trust !== false;
  const key = PINNED_KEY ?? args.publicKey ?? undefined;
  const v = new ChainVerifier({ space: args.space, mode: args.mode, publicKeyHex: key, trusted: trust ? readTrusted(args.space) : undefined });
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
  const report = await v.finish(args.checkpoints);
  if (PINNED_KEY && args.publicKey && args.publicKey !== PINNED_KEY) {
    report.findings.push({ seq: Math.max(0, report.entries - 1), rule: "signature", severity: "warning", message: "The server offered a different public key from the one this site was built with. Signatures were checked against the built-in key." });
    if (report.status === "valid") report.status = "warning";
  }
  if (trust && args.checkpoints.every((cp) => Number.isFinite(cpSize(cp)))) writeTrusted(args.space, report);
  return report;
}

/** A signed-in member's check of a whole space: chain pages and checkpoints from the app API, every hash recomputed here. */
export async function verifySpaceInBrowser(space: string, publicKey: string | null, onProgress?: (p: VerifyProgress) => void, trust = true): Promise<Report> {
  const { checkpoints } = await api<{ checkpoints: Checkpoint[] }>(`/api/app/spaces/${space}/checkpoints`);
  return runVerification({
    space, mode: "standard", publicKey, checkpoints, onProgress, trust,
    fetchPage: (cursor) => api<{ entries: ChainEntry[]; next: string | null }>(`/api/app/spaces/${space}/chain?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  });
}
