/**
 * The verifier. One implementation runs in the browser, the sentinel Function,
 * the REST API and the tests. It needs only public data and a public key.
 *
 * Chain rules (Document 3, section 4, with the spec corrections applied):
 *  1. Entry n has ID m_<space>_<n> and h.seq equal to n.
 *  2. Entry 0 links to genesis(space); entry n links to entry n-1's hash.
 *  3. hash = headerHash(h).
 *  4. When c.text is present, contentHash(c.salt, c.text) = h.contentHash.
 *  5. A memory without text must have been erased by a forget entry (which,
 *     by rule 7, always has a larger seq than its target).
 *  6. A non-tombstone vector must match h.embHash. A tombstone vector is only
 *     allowed on forget/link entries and on forgotten memories.
 *  7. Every ref points to an earlier entry of the same space.
 *  8. createdAt never decreases (2 s tolerance for clock skew).
 *
 * Erasure in progress: between a forget entry and the erasure of its target's text, the text is legitimately still
 * stored, and the forget entry carries `applied: "false"`. That flag is operational and not hashed, so anyone with
 * database access can set it. It therefore only downgrades stored text to a warning for forget entries among the
 * newest ERASURE_WINDOW entries of the chain (writers and the sentinel apply pending erasures long before a chain
 * grows past that); an older "pending" forget with text present is a resurrection.
 */
import { canonical } from "./canonical";
import { verifyCheckpointSig, checkpointHash, checkpointFileId, cpSize } from "./checkpoint";
import { entryId, iso, isEntryId, seqOf, seqStr, spaceOfId } from "./encode";
import { contentHash, embHash, genesis, headerHash, quantize } from "./hash";
import { leafHash, nodeHash, largestPow2Below } from "./merkle";
import { fromHex, toHex } from "./encode";
import { isMemoryOp } from "./metadata";
import { applyEntry, sameSet, type StateMap } from "./replay";
import { isTombstone } from "./tombstone";
import type { ChainEntry, Checkpoint, Finding, Header, PublicEntry, Report, VerifyMode } from "./types";

const SKEW_MS = 2000;
/** Forget entries this close to the head may still be erasing their target (see the header comment). */
export const ERASURE_WINDOW = 25;

export interface EntryResult { seq: number; ok: boolean }

type Input = ChainEntry | PublicEntry;
/** Full entries carry a real metadata object; anything else (hostile pages included) is read as header-only. */
const isPublic = (e: Input): e is PublicEntry => typeof (e as ChainEntry).metadata !== "object" || (e as ChainEntry).metadata === null;

interface Kept { id: string; h: Header; hash: string; full?: ChainEntry; malformed?: boolean }

const ZERO = "0".repeat(64);
const STRING_FIELDS = ["space", "seq", "prevHash", "op", "kind", "agent", "contentHash", "embHash", "model", "importance", "confidence", "validFrom", "createdAt"];

/** Shape check before hashing: a tampered header must yield a finding, never an exception. */
export function headerProblem(h: unknown): string | null {
  if (!h || typeof h !== "object") return "missing";
  const o = h as Record<string, unknown>;
  if (o.v !== "1") return "unknown format version";
  for (const k of STRING_FIELDS) if (typeof o[k] !== "string") return `${k} is not a string`;
  for (const k of ["subject", "source"]) if (o[k] !== null && typeof o[k] !== "string") return `${k} is not a string`;
  if (!["remember", "reflect", "forget", "link"].includes(o.op as string)) return "unknown op";
  const r = o.refs as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return "refs are missing";
  for (const k of ["supersedes", "contradicts", "related", "derivedFrom"]) {
    if (!Array.isArray(r[k]) || !(r[k] as unknown[]).every((x) => typeof x === "string")) return `refs.${k} is malformed`;
  }
  if (r.target !== null && typeof r.target !== "string") return "refs.target is malformed";
  try { canonical(h); } catch { return "contains non-string values"; }
  return null;
}

export class ChainVerifier {
  readonly space: string;
  readonly mode: VerifyMode;
  private publicKeyHex?: string;
  /** Keyring by checkpoint keyId, so a rotated signing key does not invalidate checkpoints signed before rotation. */
  private publicKeys: Record<string, string>;
  private findings: Finding[] = [];
  private kept: Kept[] = [];
  private prevHash: string | null = null;
  private prevSeq = -1;
  private prevCreated = "";
  private state: StateMap = new Map();
  /** Targets of forget entries whose erasure has not landed yet (applied: "false"), with the forget entry's seq. */
  private erasing = new Map<string, number>();
  private trusted?: TrustedCheckpoint;
  /** Entries before this seq were vouched for elsewhere (a verified checkpoint); see `from`. */
  private offset = 0;

  /**
   * `from` resumes verification after a prefix the caller has already established, e.g. the entries covered by a
   * checkpoint whose signature it checked and whose head it matched against the stored entry. Only entries from
   * `from.size` on are pushed, and the first must link to `from.head`. Rules that need the whole chain (derived
   * replay, content erasure, checkpoints, rollback) are skipped in this mode.
   */
  constructor(opts: {
    space: string; mode?: VerifyMode; publicKeyHex?: string; publicKeys?: Record<string, string>; trusted?: TrustedCheckpoint;
    from?: { size: number; head: string; createdAt: string };
  }) {
    this.space = opts.space;
    this.mode = opts.mode ?? "standard";
    this.publicKeyHex = opts.publicKeyHex;
    this.publicKeys = opts.publicKeys ?? {};
    this.trusted = opts.trusted;
    if (opts.from && opts.from.size > 0) {
      this.offset = opts.from.size;
      this.prevSeq = opts.from.size - 1;
      this.prevHash = opts.from.head;
      this.prevCreated = opts.from.createdAt;
    }
  }

  private add(f: Finding) { this.findings.push(f); }

  /** Feed a page of entries in chain order. Returns a per-entry verdict for animation. */
  async push(page: Input[]): Promise<EntryResult[]> {
    const out: EntryResult[] = [];
    for (const rawIn of page) {
      // A hostile page can hold anything, nulls included: malformed entries must become findings, never crashes.
      const raw: Input = rawIn && typeof rawIn === "object" ? rawIn : ({ $id: "" } as PublicEntry);
      const id = typeof raw.$id === "string" ? raw.$id : "";
      const h = isPublic(raw) ? raw.h : raw.metadata.h;
      const hash = isPublic(raw) ? raw.hash : raw.metadata.hash;
      const before = this.criticalCount();
      const expected = this.prevSeq + 1;
      const idSeq = isEntryId(id) ? seqOf(id) : NaN;

      // Rule 1: structure.
      if (!isEntryId(id) || spaceOfId(id) !== this.space) {
        this.add({ seq: expected, rule: "structure", severity: "critical", message: `Entry ${id} does not belong to this space's chain.` });
      } else if (idSeq !== expected) {
        this.add({
          seq: expected, rule: "structure", severity: "critical",
          message: idSeq > expected
            ? `Entries #${expected}${idSeq - 1 > expected ? `–#${idSeq - 1}` : ""} are missing from the chain.`
            : `Entry #${idSeq} appears out of order after #${this.prevSeq}.`,
        });
      }
      const seq = Number.isFinite(idSeq) ? idSeq : expected;
      if (!h || h.seq !== seqStr(seq) || h.space !== this.space) {
        this.add({ seq, rule: "structure", severity: "critical", message: `Entry #${seq} carries the header of ${h ? `#${Number(h.seq)}` : "nothing"}. Entries were moved or swapped.` });
      }
      const shape = headerProblem(h);
      const hashOk = typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
      if (shape || !hashOk) {
        this.add({ seq, rule: "header", severity: "critical", message: `Entry #${seq} has a malformed ${shape ? `header (${shape})` : "hash"}. It was altered outside Engram.` });
        this.kept.push({ id, h: h as Header, hash: hashOk ? hash : ZERO, malformed: true });
        this.prevHash = hashOk ? hash : ZERO;
        this.prevSeq = seq;
        out.push({ seq, ok: false });
        continue;
      }
      try {

      // Rule 2: link.
      const expectPrev = seq === 0 ? await genesis(this.space) : this.prevHash;
      if (expectPrev !== null && h.prevHash !== expectPrev) {
        this.add({ seq, rule: "link", severity: "critical", message: `Entry #${seq} does not link to the entry before it. Something before it was changed, removed or reordered.` });
      }

      // Rule 3: header hash.
      if ((await headerHash(h)) !== hash) {
        this.add({ seq, rule: "header", severity: "critical", message: `Entry #${seq} was changed after it was written: its header no longer matches its hash.` });
      }

      // Rule 7: refs point backwards inside the space.
      const r = h.refs;
      const refIds = [...r.supersedes, ...r.contradicts, ...r.related, ...r.derivedFrom, ...(r.target ? [r.target] : [])];
      for (const ref of refIds) {
        if (!isEntryId(ref) || spaceOfId(ref) !== this.space || seqOf(ref) >= seq) {
          this.add({ seq, rule: "refs", severity: "critical", message: `Entry #${seq} refers to ${ref}, which is not an earlier entry in this chain.` });
        }
      }
      if ((h.op === "forget" || h.op === "link") && !r.target) {
        this.add({ seq, rule: "refs", severity: "critical", message: `Entry #${seq} is a ${h.op} entry without a target.` });
      }

      // Rule 8: time never runs backwards.
      if (this.prevCreated && Date.parse(h.createdAt) + SKEW_MS < Date.parse(this.prevCreated)) {
        this.add({ seq, rule: "time", severity: "critical", message: `Entry #${seq} is dated before the entry that precedes it.` });
      }

      if (!isPublic(raw)) {
        const m = raw.metadata;
        if (h.op === "forget" && r.target && m.applied === "false") this.erasing.set(r.target, seq);
        // Rule 4: content.
        if (m.c?.text != null) {
          if (!m.c.salt || (await contentHash(m.c.salt, m.c.text)) !== h.contentHash) {
            this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq}'s text does not match its content hash. It was edited after it was written.` });
          }
        }
        // Rule 6: vector (deep mode).
        if (this.mode === "deep" && raw.vector && !isTombstone(raw.vector)) {
          const qv = quantize(raw.vector);
          if ((await embHash(qv)) !== h.embHash && !(m.c?.salt && (await embHash(qv, m.c.salt)) === h.embHash)) {
            this.add({ seq, rule: "vector", severity: "critical", message: `Memory #${seq}'s vector was replaced. Recall results could be poisoned.` });
          }
        }
        // Top-level copies of hashed fields.
        const copies: [string, unknown, unknown][] = [
          ["space", m.space, h.space], ["seq", m.seq, h.seq], ["op", m.op, h.op], ["kind", m.kind, h.kind],
          ["subject", m.subject, h.subject], ["agent", m.agent, h.agent], ["createdAt", m.createdAt, h.createdAt],
          ["text", m.text ?? null, m.c?.text ?? null],
        ];
        for (const [k, a, b] of copies) {
          if (a !== b) this.add({ seq, rule: "copy", severity: "warning", message: `Entry #${seq}'s searchable copy of "${k}" disagrees with the chain.` });
        }
      }

      } catch (e) {
        this.add({ seq, rule: "structure", severity: "critical", message: `Entry #${seq} could not be checked: ${e instanceof Error ? e.message : String(e)}.` });
      }
      applyEntry(this.state, id, h);
      this.kept.push({ id, h, hash, full: isPublic(raw) ? undefined : raw });
      this.prevHash = hash;
      this.prevSeq = seq;
      this.prevCreated = h.createdAt;
      out.push({ seq, ok: this.criticalCount() === before });
    }
    return out;
  }

  private criticalCount() { return this.findings.filter((f) => f.severity === "critical").length; }

  /** Derived replay, content-erasure rules, checkpoints. Produces the report. */
  async finish(checkpoints: Checkpoint[] = []): Promise<Report> {
    const resumed = this.offset > 0;
    if (this.mode !== "public" && !resumed) this.checkDerived();
    const cps = resumed ? 0 : await this.checkCheckpoints(checkpoints);

    const crit = this.findings.filter((f) => f.severity === "critical");
    const n = this.offset + this.kept.length;
    const validThrough = crit.length ? Math.min(n, ...crit.map((f) => f.seq)) - 1 : n - 1;
    this.findings.sort((a, b) => a.seq - b.seq || sev(a.severity) - sev(b.severity));
    const latest = resumed ? undefined : checkpoints.filter((cp) => !checkpointProblem(cp, this.space)).sort((a, b) => cpSize(b) - cpSize(a))[0];
    return {
      space: this.space,
      entries: n,
      validThrough,
      checkpointsValid: cps,
      checkpointsTotal: resumed ? 0 : checkpoints.length,
      latestCheckpoint: latest ? { seq: Number(latest.seq), size: cpSize(latest), root: latest.root, createdAt: latest.createdAt } : null,
      findings: this.findings,
      status: crit.length ? "tampered" : this.findings.some((f) => f.severity === "warning") ? "warning" : "valid",
      checkedAt: iso(),
      mode: this.mode,
    };
  }

  private checkDerived() {
    for (const k of this.kept) {
      const e = k.full;
      if (!e || k.malformed) continue;
      const m = e.metadata;
      const seq = seqOf(k.id);
      const want = this.state.get(k.id);
      if (!want) continue;
      // Rule 5: missing content needs a forget entry; forgotten content must stay gone.
      if (isMemoryOp(k.h.op) && m.c?.text == null && want.status !== "forgotten") {
        this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq}'s content is missing, but no forget entry erased it.` });
      }
      if (want.status === "forgotten" && m.c?.text != null) {
        // Between a forget entry and its erasure the text is legitimately still there; the forget entry says so,
        // but only a recent forget entry can still be in progress, because the flag is not hashed.
        const by = this.erasing.get(k.id);
        if (by !== undefined && by >= this.kept.length - ERASURE_WINDOW) this.add({ seq, rule: "content", severity: "warning", message: `Memory #${seq} is being forgotten; its erasure has not finished yet.` });
        else this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq} was forgotten, but text was written back into it.` });
      }
      // Rule 6 (correction): tombstone vectors only where nothing should be found.
      if (this.mode === "deep" && e.vector) {
        const tomb = isTombstone(e.vector);
        if (tomb && isMemoryOp(k.h.op) && want.status !== "forgotten") {
          this.add({ seq, rule: "vector", severity: "critical", message: `Memory #${seq}'s vector was blanked out, hiding it from recall without a forget entry.` });
        }
        if (!tomb && want.status === "forgotten") {
          this.add({ seq, rule: "vector", severity: "warning", message: `Memory #${seq} was forgotten but its vector is still stored.` });
        }
      }
      const d = m.d;
      if (!d || typeof d !== "object") {
        this.add({ seq, rule: "derived", severity: "warning", message: `Entry #${seq} has no derived state; replay says ${want.status}.` });
        continue;
      }
      const diffs: string[] = [];
      if (d.status !== want.status) diffs.push(`status says ${d.status}; replay says ${want.status}${want.supersededBy ? ` by #${seqOf(want.supersededBy)}` : ""}`);
      if (d.validTo !== want.validTo) diffs.push("validity end differs");
      if (d.supersededBy !== want.supersededBy) diffs.push("superseded-by differs");
      if (!sameSet(d.contradictedBy ?? [], want.contradictedBy)) diffs.push("conflicts differ");
      if (d.forgottenAt !== want.forgottenAt || d.forgottenBy !== want.forgottenBy) diffs.push("forget record differs");
      if (m.status !== d.status || m.validTo !== d.validTo || m.forgottenAt !== d.forgottenAt || m.conflict !== ((d.contradictedBy ?? []).length ? "true" : "false")) {
        diffs.push("searchable copies disagree with derived state");
      }
      if (diffs.length) {
        this.add({ seq, rule: "derived", severity: "warning", message: `Memory #${seq}: ${diffs.join("; ")}.` });
      }
    }
  }

  private async checkCheckpoints(all: Checkpoint[]): Promise<number> {
    // Shape first: a hostile size like "1e12" must become a finding, not a Merkle computation over a trillion leaves.
    const checkpoints = all.filter((cp) => {
      const problem = checkpointProblem(cp, this.space);
      if (problem) this.add({ seq: Math.max(0, this.kept.length - 1), rule: "checkpoint", severity: "critical", message: `A checkpoint file is malformed (${problem}). It was altered outside Engram.` });
      return !problem;
    });
    const hasKeys = !!this.publicKeyHex || Object.keys(this.publicKeys).length > 0;
    if (checkpoints.length && !hasKeys) {
      this.add({ seq: Math.max(0, this.kept.length - 1), rule: "signature", severity: "warning", message: "Checkpoint signatures were not checked: no public key was given to the verifier." });
    }
    const t = this.trusted;
    if (!checkpoints.length && !t) return 0;
    const sorted = [...checkpoints].sort((a, b) => cpSize(a) - cpSize(b));
    const leaves = await Promise.all(this.kept.map((k) => leafHash(fromHex(k.hash))));
    const memo = new Map<string, Uint8Array>();
    const rootOf = async (lo: number, hi: number): Promise<Uint8Array> => {
      const key = `${lo}:${hi}`;
      const hit = memo.get(key);
      if (hit) return hit;
      let r: Uint8Array;
      if (hi - lo === 1) r = leaves[lo];
      else {
        const k = largestPow2Below(hi - lo);
        r = await nodeHash(await rootOf(lo, lo + k), await rootOf(lo + k, hi));
      }
      memo.set(key, r);
      return r;
    };

    let valid = 0;
    let lastGoodSize = 0;
    let prev: Checkpoint | null = null;
    for (const cp of sorted) {
      const size = cpSize(cp);
      const at = size - 1;
      let ok = true;
      if (hasKeys) {
        const key = this.publicKeys[cp.keyId] ?? this.publicKeyHex;
        if (!key) {
          ok = false;
          this.add({ seq: at, rule: "signature", severity: "critical", message: `Checkpoint ${checkpointFileId(cp)} is signed with an unknown key (${cp.keyId}).` });
        } else if (!(await verifyCheckpointSig(cp, key))) {
          ok = false;
          this.add({ seq: at, rule: "signature", severity: "critical", message: `Checkpoint ${checkpointFileId(cp)} has an invalid signature.` });
        }
      }
      if (cp.space !== this.space) {
        ok = false;
        this.add({ seq: at, rule: "checkpoint", severity: "critical", message: `Checkpoint ${checkpointFileId(cp)} belongs to another space.` });
      }
      if (prev && !(await linksTo(cp, prev))) {
        ok = false;
        this.add({ seq: at, rule: "checkpoint", severity: "critical", message: `Checkpoint ${checkpointFileId(cp)} does not link to the checkpoint before it. A checkpoint was removed or replaced.` });
      }
      if (size > this.kept.length) {
        ok = false;
        const missing = size - this.kept.length;
        this.add({
          seq: this.kept.length, rule: "truncation", severity: "critical",
          message: `${missing === 1 ? "One memory is" : `${numberWord(missing)} memories are`} missing since checkpoint ${checkpointFileId(cp)}, which signed ${size} entries.`,
        });
      } else {
        const root = toHex(await rootOf(0, size));
        const head = this.kept[size - 1].hash;
        if (root !== cp.root || head !== cp.head) {
          ok = false;
          this.add({
            seq: lastGoodSize, rule: "checkpoint", severity: "critical",
            message: `Entries #${lastGoodSize}–#${at} no longer match signed checkpoint ${checkpointFileId(cp)}. History was rewritten.`,
          });
        }
      }
      if (ok) { valid++; lastGoodSize = size; }
      prev = cp;
    }

    // Rollback: a checkpoint this verifier saw before must still be covered. A server that drops newer entries
    // and serves only older, validly signed checkpoints passes every other check.
    if (t && Number.isSafeInteger(t.size) && t.size > 0) {
      const newest = sorted.length ? cpSize(sorted[sorted.length - 1]) : 0;
      if (t.size > this.kept.length || newest < t.size) {
        this.add({ seq: Math.min(this.kept.length, t.size - 1), rule: "rollback", severity: "critical", message: `This space previously had a signed checkpoint over ${t.size} entries; it now ${newest ? `only covers ${newest}` : "has none"} and the chain has ${this.kept.length}. History was rolled back.` });
      } else if (toHex(await rootOf(0, t.size)) !== t.root) {
        this.add({ seq: 0, rule: "rollback", severity: "critical", message: `The first ${t.size} entries no longer match a checkpoint this verifier saw before. History was rewritten.` });
      }
    }
    return valid;
  }
}

export interface TrustedCheckpoint { size: number; root: string }

/** Never throws: a hostile predecessor must become a finding, not a rejected promise that leaves a stale badge. */
async function linksTo(cp: Checkpoint, prev: Checkpoint): Promise<boolean> {
  try {
    return cp.prevCheckpoint === checkpointFileId(prev) && cp.prevCheckpointHash === (await checkpointHash(prev));
  } catch {
    return false;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const ANCHOR_KEYS = ["type", "repo", "commit", "path", "anchoredSeq"];

/** Every field a verifier relies on (and every field hashed into a successor's link), checked before use. */
export function checkpointProblem(cp: unknown, space?: string): string | null {
  if (!cp || typeof cp !== "object" || Array.isArray(cp)) return "not an object";
  const c = cp as Record<string, unknown>;
  if (c.v !== "1") return "unknown format version";
  if (typeof c.space !== "string") return "space is not a string";
  if (typeof c.size !== "string" || !/^\d{8}$/.test(c.size) || Number(c.size) < 1) return "size is not a positive 8-digit count";
  if (typeof c.seq !== "string" || c.seq !== seqStr(Number(c.size) - 1)) return "seq does not match size";
  for (const k of ["head", "root"]) if (typeof c[k] !== "string" || !/^[0-9a-f]{64}$/.test(c[k] as string)) return `${k} is not a hash`;
  if (typeof c.sig !== "string" || typeof c.createdAt !== "string" || typeof c.keyId !== "string") return "signature fields are missing";
  const first = c.prevCheckpoint === null && c.prevCheckpointHash === null;
  const linked = typeof c.prevCheckpoint === "string" && typeof c.prevCheckpointHash === "string" && HEX64.test(c.prevCheckpointHash);
  if (!first && !linked) return "the link to the previous checkpoint is malformed";
  if (c.anchor !== undefined && c.anchor !== null) {
    const a = c.anchor as Record<string, unknown>;
    if (typeof a !== "object" || Array.isArray(a) || a.type !== "github" || typeof a.repo !== "string" || typeof a.path !== "string"
      || typeof a.anchoredSeq !== "string" || (a.commit !== null && typeof a.commit !== "string")
      || Object.keys(a).some((k) => !ANCHOR_KEYS.includes(k))) return "the anchor is malformed";
  }
  if (space !== undefined && c.space !== space) return "it belongs to another space";
  return null;
}

const sev = (s: Finding["severity"]) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const numberWord = (n: number) => WORDS[n] ?? String(n);

/** Convenience wrapper for a full, in-memory chain. */
export async function verifySpace(args: {
  space: string;
  entries: (ChainEntry | PublicEntry)[];
  checkpoints?: Checkpoint[];
  publicKeyHex?: string;
  publicKeys?: Record<string, string>;
  mode?: VerifyMode;
  trusted?: TrustedCheckpoint;
}): Promise<Report> {
  const v = new ChainVerifier({ space: args.space, mode: args.mode, publicKeyHex: args.publicKeyHex, publicKeys: args.publicKeys, trusted: args.trusted });
  await v.push(args.entries);
  return v.finish(args.checkpoints ?? []);
}

export { entryId };

/**
 * Parses a keyring: "keyId:hex,keyId:hex". Malformed items are dropped. A single legacy key without an ID is
 * listed under `fallbackId` so checkpoints signed before keyrings existed still verify.
 */
export function parseKeyring(list: string | undefined | null, legacyKey?: string | null, fallbackId?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of (list ?? "").split(",")) {
    const m = /^\s*([A-Za-z0-9._-]{1,64})\s*:\s*([0-9a-f]{64})\s*$/.exec(item);
    if (m) out[m[1]] = m[2];
  }
  if (legacyKey && /^[0-9a-f]{64}$/.test(legacyKey) && fallbackId && !out[fallbackId]) out[fallbackId] = legacyKey;
  return out;
}

