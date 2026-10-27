/**
 * Engram entry format, version 1.
 *
 * Every value inside the hashed header `h` is a string, null, an array or a
 * nested object of those. Numbers are rejected by `canonical()` on purpose:
 * VectorsDB requires string metadata filter values, and banning numbers in
 * hashed data removes the most common cross-platform hash mismatch.
 */

export type Op = "remember" | "reflect" | "forget" | "link";
export type MemoryKind = "fact" | "preference" | "event" | "observation";
export type EntryKind = MemoryKind | "summary" | "tombstone" | LinkKind;
/**
 * What a link entry records about a pair (target, related[0]): one side wins
 * (supersede), both are true (refine), the flag was wrong (dismiss), or a
 * conflict found after the fact (contradict).
 */
export type LinkKind = "supersede" | "refine" | "dismiss" | "contradict";

export type Status = "active" | "superseded" | "forgotten" | "recorded";

export interface Refs {
  supersedes: string[];
  contradicts: string[];
  related: string[];
  target: string | null;
  derivedFrom: string[];
}

export interface Header {
  v: "1";
  space: string;
  seq: string;
  prevHash: string;
  op: Op;
  kind: EntryKind;
  agent: string;
  subject: string | null;
  contentHash: string;
  embHash: string;
  model: string;
  importance: string;
  confidence: string;
  source: string | null;
  validFrom: string;
  createdAt: string;
  refs: Refs;
}

/** Erasable content. Forgetting sets both to null. */
export interface Content {
  text: string | null;
  salt: string | null;
}

/**
 * Derived state: recomputable from the chain, so it is not covered by the
 * header hash. The verifier replays the chain and flags any disagreement.
 */
export interface Derived {
  status: Status;
  validTo: string | null;
  supersededBy: string | null;
  contradictedBy: string[];
  forgottenAt: string | null;
  forgottenBy: string | null;
  /** Operational fields below are not checked by the verifier. */
  concept: string | null;
  access: string;
  lastAccessAt: string | null;
  relateStatus: "done" | "pending" | "skipped";
}

/**
 * Full metadata object stored on a VectorsDB document. Top-level copies exist
 * only for shallow, fast filters; their source of truth is h, c or d.
 */
export interface EntryMeta {
  space: string;
  seq: string;
  h: Header;
  hash: string;
  c: Content;
  d: Derived;
  op: Op;
  kind: EntryKind;
  subject: string | null;
  agent: string;
  createdAt: string;
  status: Status;
  validTo: string | null;
  forgottenAt: string | null;
  conflict: "true" | "false";
  text: string | null;
  idem: string | null;
  /**
   * Operational: "false" until this entry's effect on its neighbours' derived
   * fields has committed. Writers apply pending entries before reading state.
   */
  applied?: "true" | "false";
}

/** An entry as the verifier sees it. `vector` is present only in deep mode. */
export interface ChainEntry {
  $id: string;
  metadata: EntryMeta;
  vector?: number[];
}

/** The public verifier only receives header fields. */
export interface PublicEntry {
  $id: string;
  h: Header;
  hash: string;
}

export interface UnsignedCheckpoint {
  v: "1";
  space: string;
  /** Seq of the last entry covered, 12-digit padded. */
  seq: string;
  /** Number of entries covered, 8-digit padded. */
  size: string;
  head: string;
  root: string;
  prevCheckpoint: string | null;
  prevCheckpointHash: string | null;
  createdAt: string;
  keyId: string;
  /** Outside timestamp for an earlier root (a commit to a public repo). Signed. */
  anchor: Anchor | null;
}

export interface Anchor {
  type: "github";
  repo: string;
  /** Commit SHA of the anchor file; null when GitHub did not report one (older anchors may carry ""). */
  commit: string | null;
  path: string;
  /** Seq of the checkpoint whose root the commit published, 12-digit padded. */
  anchoredSeq: string;
}

export interface Checkpoint extends UnsignedCheckpoint {
  /** Base64 Ed25519 signature over canonical(unsigned fields). */
  sig: string;
}

export type Severity = "critical" | "warning" | "info";
export type Rule =
  | "structure"
  | "link"
  | "header"
  | "content"
  | "vector"
  | "refs"
  | "time"
  | "derived"
  | "copy"
  | "checkpoint"
  | "signature"
  | "truncation"
  | "rollback"
  | "anchor"
  /** A check the mode promised was not run, because the server did not supply what it needed. */
  | "coverage";

export interface Finding {
  seq: number;
  rule: Rule;
  severity: Severity;
  message: string;
}

export type VerifyMode = "standard" | "deep" | "public";

export interface Report {
  space: string;
  entries: number;
  /**
   * What was actually checked, so a caller can never mistake "nothing to check" for "checked and clean".
   * `entries` counts entries that passed the shape gate; the rest count the rules that really ran on them.
   */
  checked: { entries: number; content: number; vector: number; derived: number };
  /** True only when every checkpoint counted in `checkpointsValid` had its signature verified against a key. */
  signaturesChecked: boolean;
  validThrough: number;
  /** Last seq covered by a checkpoint this run verified end to end; -1 when nothing here is signature-backed. */
  provenThrough: number;
  checkpointsValid: number;
  /** Checkpoints that were otherwise sound but whose signature could not be checked, for want of a public key. */
  checkpointsUnchecked: number;
  checkpointsTotal: number;
  latestCheckpoint: { seq: number; size: number; root: string; createdAt: string } | null;
  findings: Finding[];
  status: "valid" | "warning" | "tampered";
  checkedAt: string;
  mode: VerifyMode;
}
