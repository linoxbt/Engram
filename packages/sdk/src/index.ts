/**
 * engram-sdk: a small typed client for Engram's REST API.
 * Depends only on fetch and @engram/core (for checking proofs locally).
 */
import { checkpointProblem, isEntryId, seqOf, spaceOfId, verifyCheckpointSig, verifyProofHex, type Checkpoint, type Report } from "@engram/core";

export type MemoryKind = "fact" | "preference" | "event" | "observation";

export interface RememberInput {
  text: string;
  kind?: MemoryKind;
  subject?: string;
  importance?: number;
  confidence?: number;
  source?: string;
  validFrom?: string;
  idempotencyKey?: string;
}
export interface Relation { id: string; seq: number; relation: "duplicate" | "supersedes" | "contradicts" | "refines" | "unrelated"; reason: string; confidence: number }
export interface RememberResult { id: string; seq: number; hash: string; status: "created" | "duplicate"; relations: Relation[]; relateStatus: "done" | "pending" | "skipped" }

export interface RecallInput {
  query: string;
  k?: number;
  asOf?: string;
  kinds?: (MemoryKind | "summary")[];
  subject?: string;
  agent?: string;
  includeSuperseded?: boolean;
  /** Replay the chain for as-of validity instead of trusting derived fields. */
  verify?: boolean;
}
export interface Memory {
  id: string; seq: number; text: string | null; kind: string; subject: string | null; agent: string; agentName: string;
  createdAt: string; validFrom: string; validTo: string | null; status: "active" | "superseded" | "forgotten"; validAtAsOf: boolean;
  conflict: boolean; contradictedBy: string[]; supersedes: string[]; supersededBy: string | null; related: string[];
  score: number; distance: number | null; hash: string; importance: number; source: string | null;
  checkpoint: { seq: number; file: string } | null; note: string | null;
  /** Summaries only: the memories they restate and who wrote those. */
  derivedFrom?: string[]; sourceAgentNames?: string[];
}
/** The space's latest signed checkpoint, as the server reports it alongside an answer. */
export interface CheckpointPointer { fileId: string; seq: number; size: number; root: string; createdAt: string }
/** The last verification of the space (mirrors the server's stored status; not a local check). */
export interface IntegrityStatus {
  status: Report["status"]; validThrough: number; entries: number; findings: number; critical: number;
  checkedAt: string; firstFinding: string | null;
  /** Operator bookkeeping: when the space's owner was last alerted, and what for. */
  alertedAt?: string | null; alertedFor?: string | null;
}
export interface RecallResult {
  query: string; asOf: string | null; mode: "now" | "as-of" | "as-of-verified"; memories: Memory[]; conflicts: number;
  checkpoint: CheckpointPointer | null;
  integrity: IntegrityStatus | null;
  /** Where `integrity` comes from: a verification run by this request, or the monitor's last background sweep. */
  integritySource: "replayed" | "monitor" | null;
  /** Authoritative as-of mode: how many chain entries were replayed. */
  replayed?: number;
  tookMs: number;
}
export interface ForgetResult { forgetEntryId: string; seq: number; target: string; targetSeq: number; status: "forgotten"; erased: boolean }
export interface TimelineEntry {
  seq: number; id: string; op: string; kind: string; text: string | null; status: string; createdAt: string;
  agent: string; agentName: string; target: string | null; source: string | null;
  relations: { supersedes: string[]; contradicts: string[]; related: string[]; supersededBy: string | null; contradictedBy: string[] };
  derivedFrom?: string[]; sourceAgentNames?: string[];
}
/** One page of a subject's timeline. `next` is the cursor for the page after it, null at the end. */
export interface TimelineResult { subject: string; entries: TimelineEntry[]; next: string | null }
export interface Proof { id: string; seq: number; leaf: string; index: number; path: string[]; checkpoint: Checkpoint & { file: string }; publicKey: string | null; howToVerify: string }
export interface VerifyResult {
  status: Report["status"]; integrity: Report["status"]; entries: number; validThrough: number; checkpointsValid: number;
  latestCheckpoint: Report["latestCheckpoint"]; findings: Report["findings"]; checkedAt: string; proof?: Proof;
}
export interface ResolveResult { linkEntryId: string; seq: number; action: "supersede" | "refine" | "dismiss"; winner: string; loser: string }
export interface MeResult {
  agent: { id: string; name: string; scopes: string[] };
  space: { key: string; name: string };
  integrity: IntegrityStatus | null;
  latestCheckpoint: CheckpointPointer | null;
}

export class EngramError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "EngramError"; }
}

export interface EngramOptions {
  url: string;
  key: string;
  fetch?: typeof fetch;
  /** Retries for 429/503 (chain contention, rate limits). Default 3. */
  retries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /**
   * The checkpoint public key you trust, from somewhere other than the server you are checking (the project
   * README, your own config). verifyProof never trusts the key the server sends with a proof.
   */
  publicKey?: string;
}

export class Engram {
  private url: string;
  private key: string;
  private f: typeof fetch;
  private retries: number;
  private timeoutMs: number;
  private publicKey?: string;

  constructor(opts: EngramOptions) {
    if (!opts.url || !opts.key) throw new Error("Engram needs a url and an agent key.");
    this.url = opts.url.replace(/\/+$/, "");
    this.key = opts.key;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.retries = opts.retries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.publicKey = opts.publicKey;
  }

  /**
   * `safe` marks requests that may be repeated: reads, and writes carrying an idempotency key. Others are retried
   * only when the server says it did nothing (429, or 503 chain_busy), never after a timeout or a gateway error.
   */
  private async req<T>(method: string, path: string, body?: unknown, safe = method === "GET"): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.f(`${this.url}/api/v1${path}`, {
          method,
          headers: { Authorization: `Bearer ${this.key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (safe && attempt < this.retries) { await backoff(attempt); continue; }
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new EngramError(0, timeout ? "timeout" : "network", timeout ? `No response within ${this.timeoutMs} ms.` : `Could not reach Engram: ${e instanceof Error ? e.message : String(e)}`);
      }
      const text = await res.text();
      let data: { error?: { code?: string; message?: string } } | null = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (res.ok) {
        if (text && data === null) throw new EngramError(res.status, "bad_response", "Engram returned a response that is not JSON.");
        return data as T;
      }
      const code = data?.error?.code ?? "error";
      const retryable = res.status === 429 || (res.status === 503 && (safe || code === "chain_busy"));
      if (retryable && attempt < this.retries) { await backoff(attempt); continue; }
      throw new EngramError(res.status, code, data?.error?.message ?? `HTTP ${res.status}`);
    }
  }

  /** Save a durable memory. Retries are safe: an idempotency key is generated when you do not pass one. */
  async remember(input: RememberInput) {
    if (input.text.length > 2000) throw new EngramError(413, "too_large", "Memories are limited to 2,000 characters. Split long text into several memories.");
    return this.req<RememberResult>("POST", "/memories", { ...input, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() }, true);
  }
  recall(input: RecallInput) { return this.req<RecallResult>("POST", "/recall", input, true); }
  forget(id: string, reason?: string) { return this.req<ForgetResult>("POST", `/memories/${encodeURIComponent(id)}/forget`, { reason }); }
  get(id: string) { return this.req<Record<string, unknown>>("GET", `/memories/${encodeURIComponent(id)}`); }
  timeline(subject: string, limit = 100, cursor?: string) {
    const q = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    return this.req<TimelineResult>("GET", `/subjects/${encodeURIComponent(subject)}/timeline?${q}`);
  }
  verify(opts: { mode?: "standard" | "deep"; id?: string } = {}) {
    const q = new URLSearchParams({ mode: opts.mode ?? "standard", ...(opts.id ? { id: opts.id } : {}) });
    return this.req<VerifyResult>("GET", `/verify?${q}`);
  }
  proof(id: string) { return this.req<Proof>("GET", `/memories/${encodeURIComponent(id)}/proof`); }
  resolve(input: { winnerId: string; loserId: string; action?: "supersede" | "refine" | "dismiss"; reason?: string }) { return this.req<ResolveResult>("POST", "/conflicts/resolve", input); }
  me() { return this.req<MeResult>("GET", "/me"); }

  /**
   * Check an inclusion proof locally: the Merkle path must reach the signed root, the checkpoint must be the one
   * for the entry's own space, and its signature must be valid under a key you trust (the `publicKey` option, or
   * `trustedPublicKey` here). The key the server sends with the proof is ignored: a server you are checking cannot
   * vouch for itself. Without a trusted key the result is never ok. Pass `expectedHash` (the hash remember
   * returned) to pin the leaf too. Nothing a server can send makes this throw.
   */
  async verifyProof(p: Proof, trustedPublicKey?: string, expectedHash?: string): Promise<{ ok: boolean; rootOk: boolean; signatureOk: boolean | null; problem?: string }> {
    try {
      const problem = proofProblem(p, expectedHash);
      if (problem) return { ok: false, rootOk: false, signatureOk: null, problem };
      const rootOk = await verifyProofHex(p.leaf, p.index, Number(p.checkpoint.size), p.path, p.checkpoint.root);
      const key = trustedPublicKey ?? this.publicKey;
      const signatureOk = key ? await verifyCheckpointSig(p.checkpoint, key) : null;
      return { ok: rootOk && signatureOk === true, rootOk, signatureOk, ...(key ? {} : { problem: "no trusted public key: pass publicKey to the client" }) };
    } catch (e) {
      // A backstop, so a proof that gets past the checks above still cannot throw inside a caller's verify step.
      return { ok: false, rootOk: false, signatureOk: null, problem: `the proof could not be checked: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
/** A Merkle path over an 8-digit checkpoint size is at most 27 hashes; anything longer is not a path. */
const MAX_PATH = 32;

/**
 * Everything the proof must satisfy before any hashing. The space comes from the entry id, never from the
 * checkpoint: the signing key is one key for every space, so a genuinely signed checkpoint from a space the
 * attacker controls would otherwise "prove" membership here.
 */
function proofProblem(p: Proof, expectedHash?: string): string | null {
  if (!p || typeof p !== "object") return "not a proof";
  if (typeof p.id !== "string" || !isEntryId(p.id)) return "the entry id is malformed";
  const cp = checkpointProblem(p.checkpoint, spaceOfId(p.id));
  if (cp) return cp;
  if (typeof p.leaf !== "string" || !HEX64.test(p.leaf)) return "the leaf is not a hash";
  if (expectedHash && p.leaf !== expectedHash) return "the proof is for a different entry";
  if (!Number.isSafeInteger(p.index) || p.index < 0 || p.index >= Number(p.checkpoint.size)) return "the leaf index is outside the checkpoint";
  if (seqOf(p.id) !== p.index) return "the leaf index is not the entry's position in the chain";
  if (p.seq !== p.index) return "seq does not match the leaf index";
  if (!Array.isArray(p.path) || p.path.length > MAX_PATH) return "the Merkle path is malformed";
  if (p.path.some((h) => typeof h !== "string" || !HEX64.test(h))) return "the Merkle path contains something that is not a hash";
  return null;
}

const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 200 * 2 ** attempt + Math.random() * 100));

export default Engram;
