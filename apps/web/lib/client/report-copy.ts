/**
 * Honest wording for verification results. One place decides what a report status means on screen, so the public
 * verifier, the chain page, the Overview and the Tamper Lab never disagree, and a warning is never shown as green.
 */
import type { Finding, Report, Rule } from "@engram/core";

export type Tone = "valid" | "warning" | "tampered";

/** The defence layer that raises each rule (also used by the landing page's playground). */
export const LAYER: Record<Rule, string> = {
  content: "Salted content hash",
  header: "Header hash",
  link: "Chain link",
  checkpoint: "Signed Merkle checkpoint",
  signature: "Checkpoint signature",
  structure: "Sequence structure",
  truncation: "Signed checkpoint size",
  derived: "Chain replay",
  time: "Monotonic time",
  vector: "Vector hash",
  refs: "Reference rules",
  copy: "Searchable copies",
  rollback: "Rollback memory",
  anchor: "Public GitHub anchor",
  coverage: "Check coverage",
};

export const criticalOf = (r: Pick<Report, "findings">) => r.findings.filter((f) => f.severity === "critical");
export const warningsOf = (r: Pick<Report, "findings">) => r.findings.filter((f) => f.severity === "warning");

/** Why a report that verifies its hashes is still only a warning, in a few words. */
export function warningReason(warnings: Pick<Finding, "rule" | "message">[]): string {
  const rules = new Set(warnings.map((w) => w.rule));
  const parts: string[] = [];
  if (rules.has("signature")) parts.push("signatures not independently checked");
  if (rules.has("derived") || rules.has("copy")) parts.push("derived fields disagree with the chain");
  if (warnings.some((w) => w.rule === "content" && /being forgotten/.test(w.message))) parts.push("an erasure is still finishing");
  if (warnings.some((w) => w.rule === "vector")) parts.push("a forgotten vector is still stored");
  if (rules.has("coverage")) parts.push("the server did not supply what some checks needed");
  if (!parts.length) parts.push(`${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`);
  return parts.join("; ");
}

/** The one-line verdict for a report. */
export function reportHeadline(r: Report): { tone: Tone; text: string } {
  if (r.status === "tampered") {
    const c = criticalOf(r)[0];
    if (!c) return { tone: "tampered", text: `Verification failed after #${r.validThrough}.` };
    if (["truncation", "rollback", "signature", "checkpoint"].includes(c.rule)) return { tone: "tampered", text: c.message };
    return { tone: "tampered", text: `Memory #${c.seq} was changed after it was written.` };
  }
  if (r.status === "warning") {
    return { tone: "warning", text: `Hashes verify through #${r.validThrough}; ${warningReason(warningsOf(r))}.` };
  }
  return { tone: "valid", text: `Verified through #${r.validThrough}.` };
}

/** The defence that fired: the layer of the first critical finding, else of the first warning. */
export function caughtBy(r: Report): { layer: string; finding: Finding } | null {
  const f = criticalOf(r)[0] ?? warningsOf(r)[0];
  return f ? { layer: LAYER[f.rule] ?? f.rule, finding: f } : null;
}

/** A stored integrity badge is stale when entries were written after it was computed. */
export function staleBy(integrity: { entries: number } | null | undefined, head: number | null | undefined): number {
  if (!integrity || head == null || !Number.isFinite(head)) return 0;
  return Math.max(0, head - integrity.entries);
}
