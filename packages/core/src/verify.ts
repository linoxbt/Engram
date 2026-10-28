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
 * Coverage: a check that could not run is reported, never passed over. An entry served header-only (or, in deep
 * mode, without its vector) switches off the rules that would have covered it, so `Report.checked` says how many
 * entries each rule really ran on and a `coverage` finding names the ones that were downgraded. `public` mode is
 * the one legitimate headers-only mode.
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
/**
 * Derived state has its own, much shorter in-flight window. A neighbour update commits in the same request as the
 * append that caused it (erasure, by contrast, waits for a later sweep), so only the entry being written, and the
 * one before it in a page read mid-write, can legitimately disagree with the replay; anything older is a rewrite,
 * not a race. An entry that still says `applied: "false"` gets PENDING_DERIVED_WINDOW instead — wider, because a
 * crashed writer is real, but bounded, because the flag is not hashed and whoever holds the database sets it.
 */
export const DERIVED_WINDOW = 2;
/**
 * The same window for an entry that still says `applied: "false"`. A crashed writer can leave an append pending
 * while later entries land on top, so a pending entry deserves more grace than a settled one — but `applied` is
 * not hashed, so it cannot buy unlimited grace. Without a bound here, anyone with database access could park a
 * rewritten derived state behind a flag they control and hold the finding at "warning" forever, at any depth.
 * Writers apply pending entries oldest-first on every append, so a genuine one is resolved long before this.
 */
export const PENDING_DERIVED_WINDOW = ERASURE_WINDOW;
/**
 * And how long a pending claim stays plausible in wall-clock time. Position alone is not enough: a space that
 * stops being written to keeps its last entries inside the window for good, so on a dormant chain the flag would
 * still buy unlimited grace. A neighbour update lands in the same request, and the sentinel sweeps every 15
 * minutes, so an hour is generous. `createdAt` is inside the hashed header, so moving it breaks the header hash,
 * and the age is bounded in both directions: an entry dated ahead of the clock is not a write still in flight.
 */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * Allowance for the gap between the clock reading `now` and the one that wrote `createdAt`. SKEW_MS is two
 * seconds because rule 8 compares entries written by the same server; this comparison crosses machines — the
 * verifier usually runs in a visitor's browser — so it needs room for an ordinary wrong clock. Five minutes
 * matches what the write path already allows a caller's explicit `createdAt` to run ahead by.
 */
export const CLOCK_SKEW_MS = 5 * 60_000;

export interface EntryResult { seq: number; ok: boolean }

type Input = ChainEntry | PublicEntry;
/** Full entries carry a real metadata object; anything else (hostile pages included) is read as header-only. */
const isPublic = (e: Input): e is PublicEntry => typeof (e as ChainEntry).metadata !== "object" || (e as ChainEntry).metadata === null;

interface Kept { id: string; h: Header; hash: string; full?: ChainEntry; malformed?: boolean }

const ZERO = "0".repeat(64);
const LINK_KINDS = ["supersede", "refine", "dismiss", "contradict"];
const STRING_FIELDS = ["space", "seq", "prevHash", "op", "kind", "agent", "contentHash", "embHash", "model", "importance", "confidence", "validFrom", "createdAt"];

/** Shape check before hashing: a tampered header must yield a finding, never an exception. */
export function headerProblem(h: unknown): string | null {
  if (!h || typeof h !== "object") return "missing";
  const o = h as Record<string, unknown>;
  if (o.v !== "1") return "unknown format version";
  for (const k of STRING_FIELDS) if (typeof o[k] !== "string") return `${k} is not a string`;
  for (const k of ["subject", "source"]) if (o[k] !== null && typeof o[k] !== "string") return `${k} is not a string`;
  if (!["remember", "reflect", "forget", "link"].includes(o.op as string)) return "unknown op";
  // A link entry's kind decides what the replay does with the pair, so it is as load-bearing as op itself:
  // without this, a link forged with kind "fact" fell through the reducer and quietly unlinked a contradiction.
  if (o.op === "link" && !LINK_KINDS.includes(o.kind as string)) return "a link entry's kind is not a link kind";
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
  /** Rule 8 runs against the running maximum, not the previous entry: otherwise the chain can walk back forever. */
  private maxCreated = -Infinity;
  private state: StateMap = new Map();
  /** Targets of forget entries whose erasure has not landed yet (applied: "false"), with the forget entry's seq. */
  private erasing = new Map<string, number>();
  /** What the verifier actually ran, reported as `checked` so a skipped check can never read as a passed one. */
  private counts = { entries: 0, content: 0, vector: 0, derived: 0 };
  /** Seqs the server served header-only although the mode asks for contents, and seqs with no vector in deep mode. */
  private headerOnly: number[] = [];
  private noVector: number[] = [];
  /** Seq of the entry that last changed each ID's derived state, and the entries that say they are mid-update. */
  private changedBy = new Map<string, number>();
  private unapplied = new Set<number>();
  /** createdAt of each entry, by seq: the hashed timestamp an in-flight claim is measured against. */
  private createdBySeq = new Map<number, number>();
  private readonly now: number;
  private signaturesChecked = false;
  private provenThrough = -1;
  /** Checkpoints that were otherwise sound but whose signature nobody could check. Never counted as valid. */
  private unchecked = 0;
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
    /** Wall clock, injectable so tests are deterministic. Only used to expire a pending in-flight claim. */
    now?: number;
  }) {
    this.space = opts.space;
    this.now = opts.now ?? Date.now();
    this.mode = opts.mode ?? "standard";
    this.publicKeyHex = opts.publicKeyHex;
    // Null-prototype: otherwise keyId "toString" resolves an inherited member and reads as a bad signature, and a
    // caller's "__proto__" entry would never be found at all.
    this.publicKeys = Object.assign(Object.create(null) as Record<string, string>, opts.publicKeys ?? {});
    this.trusted = opts.trusted;
    if (opts.from && opts.from.size > 0) {
      this.offset = opts.from.size;
      this.prevSeq = opts.from.size - 1;
      this.prevHash = opts.from.head;
      this.maxCreated = Date.parse(opts.from.createdAt);
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
      const created = Date.parse(h.createdAt);
      this.counts.entries++;
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

      // Rule 8: time never runs backwards. Against the running maximum, so SKEW_MS is an allowance per entry and
      // not a budget per step that a chain can spend over and over to drift back without limit.
      if (Number.isFinite(this.maxCreated) && created + SKEW_MS < this.maxCreated) {
        this.add({ seq, rule: "time", severity: "critical", message: `Entry #${seq} is dated before an entry that precedes it.` });
      }

      if (isPublic(raw)) {
        // Rule 4, rule 6 and the derived replay all need the entry's contents. The mode decides whether that is
        // legitimate; either way it is counted and, outside public mode, reported by `finish`.
        if (this.mode !== "public") this.headerOnly.push(seq);
      } else {
        const m = raw.metadata;
        if (m.applied === "false") this.unapplied.add(seq);
        this.createdBySeq.set(seq, created);
        if (h.op === "forget" && r.target && m.applied === "false") this.erasing.set(r.target, seq);
        // Rule 4: content.
        if (m.c?.text != null) {
          this.counts.content++;
          if (!m.c.salt || (await contentHash(m.c.salt, m.c.text)) !== h.contentHash) {
            this.add({ seq, rule: "content", severity: "critical", message: `Memory #${seq}'s text does not match its content hash. It was edited after it was written.` });
          } else if (m.c.text !== m.c.text.normalize("NFC")) {
            // The hash is taken over the NFC form, so a differently composed string with the same meaning passes
            // rule 4. Keeping the hash as it is keeps every stored chain verifying; the text itself is flagged.
            this.add({ seq, rule: "content", severity: "warning", message: `Memory #${seq}'s text is not in normal form NFC, so its content hash does not pin the exact characters stored.` });
          }
        }
        // Rule 6: vector (deep mode).
        if (this.mode === "deep" && !Array.isArray(raw.vector)) this.noVector.push(seq);
        else if (this.mode === "deep" && raw.vector && !isTombstone(raw.vector)) {
          const qv = quantize(raw.vector);
          try {
            const bad = (await embHash(qv)) !== h.embHash && !(m.c?.salt && (await embHash(qv, m.c.salt)) === h.embHash);
            this.counts.vector++;
            if (bad) this.add({ seq, rule: "vector", severity: "critical", message: `Memory #${seq}'s vector was replaced. Recall results could be poisoned.` });
          } catch {
            // Out of range or not a number: not a vector this chain could ever have hashed.
            this.add({ seq, rule: "vector", severity: "critical", message: `Memory #${seq}'s vector holds values no embedding can hold. It was written outside Engram.` });
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
      // The causing entry decides whether a later derived mismatch is a race or a rewrite (see DERIVED_WINDOW).
      for (const cid of applyEntry(this.state, id, h)) this.changedBy.set(cid, seq);
      this.kept.push({ id, h, hash, full: isPublic(raw) ? undefined : raw });
      this.prevHash = hash;
      this.prevSeq = seq;
      if (Number.isFinite(created) && created > this.maxCreated) this.maxCreated = created;
      out.push({ seq, ok: this.criticalCount() === before });
    }
    return out;
  }

  private criticalCount() { return this.findings.filter((f) => f.severity === "critical").length; }

  /** Derived replay, content-erasure rules, checkpoints. Produces the report. */
  async finish(checkpoints: Checkpoint[] = []): Promise<Report> {
    const resumed = this.offset > 0;
    if (this.mode !== "public" && !resumed) this.checkDerived();
    this.checkCoverage();
    const cps = resumed ? 0 : await this.checkCheckpoints(checkpoints);

    const crit = this.findings.filter((f) => f.severity === "critical");
    const n = this.offset + this.kept.length;
    const validThrough = crit.length ? Math.min(n, ...crit.map((f) => f.seq)) - 1 : n - 1;
    this.findings.sort((a, b) => a.seq - b.seq || sev(a.severity) - sev(b.severity));
    const latest = resumed ? undefined : checkpoints.filter((cp) => !checkpointProblem(cp, this.space)).sort((a, b) => cpSize(b) - cpSize(a))[0];
    return {
      space: this.space,
      entries: n,
      checked: { ...this.counts },
      signaturesChecked: this.signaturesChecked,
      validThrough,
      provenThrough: this.provenThrough,
      checkpointsValid: cps,
      checkpointsUnchecked: this.unchecked,
      checkpointsTotal: resumed ? 0 : checkpoints.length,
      latestCheckpoint: latest ? { seq: Number(latest.seq), size: cpSize(latest), root: latest.root, createdAt: latest.createdAt } : null,
      findings: this.findings,
      status: crit.length ? "tampered" : this.findings.some((f) => f.severity === "warning") ? "warning" : "valid",
      checkedAt: iso(),
      mode: this.mode,
    };
  }

  /**
   * Coverage. Serving one entry header-only, or without its vector in deep mode, silently switches off the checks
   * that would have covered it. Nothing legitimate omits only some entries' contents, and that shape is exactly
   * how a hostile server would hide a single edited entry, so a partial omission is critical. A response that is
   * uniformly header-only is a mode mismatch rather than evidence of tampering, so it is a warning — but it is
   * still a finding, because the report must never read "valid" for checks that never ran. `public` mode is the
   * one legitimate headers-only mode and is exempt.
   */
  private checkCoverage() {
    const total = this.kept.length;
    const say = (seqs: number[], rule: Finding["rule"], what: string, skipped: string) => {
      const all = seqs.length >= total;
      this.add({
        seq: seqs[0], rule, severity: all ? "warning" : "critical",
        message: all
          ? `No entry was served with its ${what}, so ${skipped} did not run.`
          : `${listSeqs(seqs)} served without ${seqs.length === 1 ? "its" : "their"} ${what} while the rest were served in full, so ${skipped} did not run for ${seqs.length === 1 ? "it" : "them"}.`,
      });
    };
    if (this.headerOnly.length) say(this.headerOnly, "coverage", "contents", `the content and derived checks ${this.mode} mode promises`);
    if (this.noVector.length) say(this.noVector, "vector", "vector", "the vector check deep mode promises");
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
      // Derived state is recomputable from the signed chain, so a mismatch is unambiguous — except while the
      // entry that caused it is still being applied. That is the only honest excuse, and it is narrow.
      const by = this.changedBy.get(k.id);
      const pending = by !== undefined && this.unapplied.has(by);
      const window = pending ? PENDING_DERIVED_WINDOW : DERIVED_WINDOW;
      // A pending claim must be recent in time as well as in position, or a chain that stops growing would hold
      // its last entries inside the window for good. The settled window is two entries, which no clock can stretch.
      const causedAt = by === undefined ? undefined : this.createdBySeq.get(by);
      // Bounded at both ends. Past: the claim expires. Future: a negative age would otherwise sit inside any
      // limit for good, and the verifier must hold for a chain from anywhere, not only one this server wrote.
      const age = causedAt === undefined ? undefined : this.now - causedAt;
      const fresh = !pending || (age !== undefined && age >= -CLOCK_SKEW_MS && age <= PENDING_MAX_AGE_MS + CLOCK_SKEW_MS);
      const inFlight = by !== undefined && by >= this.kept.length - window && fresh;
      const severity: Finding["severity"] = inFlight ? "warning" : "critical";
      const d = m.d;
      if (!d || typeof d !== "object") {
        this.add({ seq, rule: "derived", severity, message: `Entry #${seq} has no derived state; replay says ${want.status}.` });
        continue;
      }
      this.counts.derived++;
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
        this.add({ seq, rule: "derived", severity, message: `Memory #${seq}: ${diffs.join("; ")}.` });
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
    this.signaturesChecked = hasKeys && checkpoints.length > 0;
    if (checkpoints.length && !hasKeys) {
      // Stays a warning, not a critical: a missing key is this verifier's own configuration, and calling every
      // unpinned deployment "tampered" would cry wolf. What changes is that nothing here is counted as valid.
      this.add({ seq: Math.max(0, this.kept.length - 1), rule: "signature", severity: "warning", message: `No public key was given to the verifier, so ${checkpoints.length === 1 ? "this checkpoint proves" : "these checkpoints prove"} nothing: their signatures were not checked.` });
    }
    const t = this.trusted;
    if (!checkpoints.length && !t) return 0;
    const sorted = [...checkpoints].sort((a, b) => cpSize(a) - cpSize(b));
    // The first checkpoint presented must be the genesis one. Otherwise a server can drop the early checkpoints,
    // and the outside anchors that published their roots, and every remaining link still checks out.
    if (sorted.length && !t && sorted[0].prevCheckpoint !== null) {
      this.add({ seq: 0, rule: "checkpoint", severity: "warning", message: `The earliest checkpoint offered (${checkpointFileId(sorted[0])}) is not the first checkpoint of this space: it links back to ${sorted[0].prevCheckpoint}, which was not presented.` });
    }
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
        const key = this.publicKeys[cp.keyId] ?? this.publicKeyHex; // null-prototype: never an inherited member
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
      // `lastGoodSize` tracks the structurally sound prefix for the message above; validity needs a signature too.
      if (ok) {
        lastGoodSize = size;
        if (hasKeys) { valid++; this.provenThrough = Math.max(this.provenThrough, at); }
        else this.unchecked++;
      }
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

const listSeqs = (seqs: number[]) => {
  const shown = seqs.slice(0, 8).map((s) => `#${s}`);
  const more = seqs.length - shown.length;
  return `${seqs.length === 1 ? "Entry" : "Entries"} ${shown.join(", ")}${more ? ` and ${more} more` : ""} ${seqs.length === 1 ? "was" : "were"}`;
};

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
  now?: number;
}): Promise<Report> {
  const v = new ChainVerifier({ space: args.space, mode: args.mode, publicKeyHex: args.publicKeyHex, publicKeys: args.publicKeys, trusted: args.trusted, now: args.now });
  await v.push(args.entries);
  return v.finish(args.checkpoints ?? []);
}

export { entryId };

/** Key ids that would write through to Object.prototype, or read back as something that was never configured. */
const RESERVED_KEY_IDS = ["__proto__", "constructor", "prototype"];

/**
 * Parses a keyring: "keyId:hex,keyId:hex". A single legacy key without an ID is listed under `fallbackId` so
 * checkpoints signed before keyrings existed still verify. Items that do not parse are returned in `dropped`
 * instead of vanishing: one malformed item used to empty the ring, which downgrades a site from pinned keys to
 * trusting whatever the server offers, silently. The map has a null prototype so a key id can never resolve an
 * inherited member, and reserved ids are refused outright.
 */
export function parseKeyringStrict(list: string | undefined | null, legacyKey?: string | null, fallbackId?: string | null): { keys: Record<string, string>; dropped: string[] } {
  const keys = Object.create(null) as Record<string, string>;
  const dropped: string[] = [];
  for (const item of (list ?? "").split(",")) {
    if (!item.trim()) continue;
    const m = /^\s*([A-Za-z0-9._-]{1,64})\s*:\s*([0-9a-fA-F]{64})\s*$/.exec(item);
    if (m && !RESERVED_KEY_IDS.includes(m[1])) keys[m[1]] = m[2].toLowerCase();
    else dropped.push(item.trim());
  }
  const legacy = legacyKey?.trim();
  if (legacy && /^[0-9a-fA-F]{64}$/.test(legacy) && fallbackId && !RESERVED_KEY_IDS.includes(fallbackId) && !keys[fallbackId]) keys[fallbackId] = legacy.toLowerCase();
  else if (legacy && fallbackId && !keys[fallbackId]) dropped.push(fallbackId);
  return { keys, dropped };
}

/** The map alone, for callers that only need the ring. See `parseKeyringStrict` to learn what was dropped. */
export function parseKeyring(list: string | undefined | null, legacyKey?: string | null, fallbackId?: string | null): Record<string, string> {
  return parseKeyringStrict(list, legacyKey, fallbackId).keys;
}

