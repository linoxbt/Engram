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
 */
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

export interface EntryResult { seq: number; ok: boolean }

type Input = ChainEntry | PublicEntry;
const isPublic = (e: Input): e is PublicEntry => (e as PublicEntry).h !== undefined && (e as ChainEntry).metadata === undefined;

interface Kept { id: string; h: Header; hash: string; full?: ChainEntry }

export class ChainVerifier {
  readonly space: string;
  readonly mode: VerifyMode;
  private publicKeyHex?: string;
  private findings: Finding[] = [];
  private kept: Kept[] = [];
  private prevHash: string | null = null;
  private prevSeq = -1;
  private prevCreated = "";
  private state: StateMap = new Map();

  constructor(opts: { space: string; mode?: VerifyMode; publicKeyHex?: string }) {
    this.space = opts.space;
    this.mode = opts.mode ?? "standard";
    this.publicKeyHex = opts.publicKeyHex;
  }

  private add(f: Finding) { this.findings.push(f); }

  /** Feed a page of entries in chain order. Returns a per-entry verdict for animation. */
  async push(page: Input[]): Promise<EntryResult[]> {
    const out: EntryResult[] = [];
    for (const raw of page) {
      const id = raw.$id;
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
      if (!h) { out.push({ seq, ok: false }); this.prevSeq = seq; continue; }

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
        // Rule 4: content.
        if (m.c?.text != null) {
          if (!m.c.salt || (await contentHash(m.c.salt, m.c.text)) !== h.contentHash) {
            this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq}'s text does not match its content hash. It was edited after it was written.` });
          }
        }
        // Rule 6: vector (deep mode).
        if (this.mode === "deep" && raw.vector && !isTombstone(raw.vector)) {
          if ((await embHash(quantize(raw.vector))) !== h.embHash) {
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
    if (this.mode !== "public") this.checkDerived();
    const cps = await this.checkCheckpoints(checkpoints);

    const crit = this.findings.filter((f) => f.severity === "critical");
    const n = this.kept.length;
    const validThrough = crit.length ? Math.min(n, ...crit.map((f) => f.seq)) - 1 : n - 1;
    this.findings.sort((a, b) => a.seq - b.seq || sev(a.severity) - sev(b.severity));
    const latest = [...checkpoints].sort((a, b) => cpSize(b) - cpSize(a))[0];
    return {
      space: this.space,
      entries: n,
      validThrough,
      checkpointsValid: cps,
      checkpointsTotal: checkpoints.length,
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
      if (!e) continue;
      const m = e.metadata;
      const seq = seqOf(k.id);
      const want = this.state.get(k.id);
      if (!want || !m.d) continue;
      // Rule 5: missing content needs a forget entry; forgotten content must stay gone.
      if (isMemoryOp(k.h.op) && m.c?.text == null && want.status !== "forgotten") {
        this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq}'s content is missing, but no forget entry erased it.` });
      }
      if (want.status === "forgotten" && m.c?.text != null) {
        this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq} was forgotten, but text was written back into it.` });
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
      const diffs: string[] = [];
      if (d.status !== want.status) diffs.push(`status says ${d.status}; replay says ${want.status}${want.supersededBy ? ` by #${seqOf(want.supersededBy)}` : ""}`);
      if (d.validTo !== want.validTo) diffs.push("validity end differs");
      if (d.supersededBy !== want.supersededBy) diffs.push("superseded-by differs");
      if (!sameSet(d.contradictedBy ?? [], want.contradictedBy)) diffs.push("conflicts differ");
      if (d.forgottenAt !== want.forgottenAt || d.forgottenBy !== want.forgottenBy) diffs.push("forget record differs");
      if (m.status !== d.status || m.validTo !== d.validTo || m.forgottenAt !== d.forgottenAt || m.conflict !== (d.contradictedBy.length ? "true" : "false")) {
        diffs.push("searchable copies disagree with derived state");
      }
      if (diffs.length) {
        this.add({ seq, rule: "derived", severity: "warning", message: `Memory #${seq}: ${diffs.join("; ")}.` });
      }
    }
  }

  private async checkCheckpoints(checkpoints: Checkpoint[]): Promise<number> {
    if (!checkpoints.length) return 0;
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
      if (this.publicKeyHex) {
        if (!(await verifyCheckpointSig(cp, this.publicKeyHex))) {
          ok = false;
          this.add({ seq: at, rule: "signature", severity: "critical", message: `Checkpoint ${checkpointFileId(cp)} has an invalid signature.` });
        }
      }
      if (cp.space !== this.space) {
        ok = false;
        this.add({ seq: at, rule: "checkpoint", severity: "critical", message: `Checkpoint ${checkpointFileId(cp)} belongs to another space.` });
      }
      if (prev && (cp.prevCheckpoint !== checkpointFileId(prev) || cp.prevCheckpointHash !== (await checkpointHash(prev)))) {
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
    return valid;
  }
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
  mode?: VerifyMode;
}): Promise<Report> {
  const v = new ChainVerifier({ space: args.space, mode: args.mode, publicKeyHex: args.publicKeyHex });
  await v.push(args.entries);
  return v.finish(args.checkpoints ?? []);
}

export { entryId };
