/**
 * engram-sdk: a small typed client for Engram's REST API.
 * Depends only on fetch and @engram/core (for checking proofs locally).
 */
import { verifyCheckpointSig, verifyProofHex, type Checkpoint, type Report } from "@engram/core";

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
}
export interface RecallResult { query: string; asOf: string | null; mode: "now" | "as-of" | "as-of-verified"; memories: Memory[]; conflicts: number; replayed?: number; tookMs: number }
export interface ForgetResult { forgetEntryId: string; seq: number; target: string; targetSeq: number; status: "forgotten"; erased: boolean }
export interface TimelineEntry { seq: number; id: string; op: string; kind: string; text: string | null; status: string; createdAt: string; agent: string; agentName: string; target: string | null }
export interface Proof { id: string; seq: number; leaf: string; index: number; path: string[]; checkpoint: Checkpoint & { file: string }; publicKey: string | null; howToVerify: string }
export interface VerifyResult { status: "valid" | "tampered"; integrity: Report["status"]; entries: number; validThrough: number; checkpointsValid: number; findings: Report["findings"]; proof?: Proof }

export class EngramError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "EngramError"; }
}

export interface EngramOptions {
  url: string;
  key: string;
  fetch?: typeof fetch;
  /** Retries for 429/503 (chain contention, rate limits). Default 3. */
  retries?: number;
}

export class Engram {
  private url: string;
  private key: string;
  private f: typeof fetch;
  private retries: number;

  constructor(opts: EngramOptions) {
    if (!opts.url || !opts.key) throw new Error("Engram needs a url and an agent key.");
    this.url = opts.url.replace(/\/+$/, "");
    this.key = opts.key;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.retries = opts.retries ?? 3;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.f(`${this.url}/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (res.ok) return data as T;
      if ((res.status === 429 || res.status === 503) && attempt < this.retries) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt + Math.random() * 100));
        continue;
      }
      throw new EngramError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `HTTP ${res.status}`);
    }
  }

  /** Save a durable memory. Pass an idempotencyKey to make retries safe. */
  remember(input: RememberInput) {
    if (input.text.length > 2000) throw new EngramError(413, "too_large", "Memories are limited to 2,000 characters. Split long text into several memories.");
    return this.req<RememberResult>("POST", "/memories", input);
  }
  recall(input: RecallInput) { return this.req<RecallResult>("POST", "/recall", input); }
  forget(id: string, reason?: string) { return this.req<ForgetResult>("POST", `/memories/${encodeURIComponent(id)}/forget`, { reason }); }
  get(id: string) { return this.req<Record<string, unknown>>("GET", `/memories/${encodeURIComponent(id)}`); }
  timeline(subject: string, limit = 100) { return this.req<{ subject: string; entries: TimelineEntry[] }>("GET", `/subjects/${encodeURIComponent(subject)}/timeline?limit=${limit}`); }
  verify(opts: { mode?: "standard" | "deep"; id?: string } = {}) {
    const q = new URLSearchParams({ mode: opts.mode ?? "standard", ...(opts.id ? { id: opts.id } : {}) });
    return this.req<VerifyResult>("GET", `/verify?${q}`);
  }
  proof(id: string) { return this.req<Proof>("GET", `/memories/${encodeURIComponent(id)}/proof`); }
  resolve(input: { winnerId: string; loserId: string; action?: "supersede" | "refine" | "dismiss"; reason?: string }) { return this.req<{ linkEntryId: string; seq: number }>("POST", "/conflicts/resolve", input); }
  me() { return this.req<{ agent: { id: string; name: string; scopes: string[] }; space: { key: string; name: string } }>("GET", "/me"); }

  /**
   * Check an inclusion proof locally: the Merkle path must reach the signed
   * root, and (with a public key) the checkpoint signature must be valid.
   * Pass the public key you trust, for example the one in the project README.
   */
  async verifyProof(p: Proof, trustedPublicKey?: string): Promise<{ ok: boolean; rootOk: boolean; signatureOk: boolean | null }> {
    const rootOk = await verifyProofHex(p.leaf, p.index, Number(p.checkpoint.size), p.path, p.checkpoint.root);
    const key = trustedPublicKey ?? p.publicKey;
    const signatureOk = key ? await verifyCheckpointSig(p.checkpoint, key) : null;
    return { ok: rootOk && signatureOk !== false, rootOk, signatureOk };
  }
}

export default Engram;
