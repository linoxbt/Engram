/** Short text blocks written for a model to read, returned alongside structuredContent. */
import { shortHash } from "@engram/core";
import type { ForgetResult } from "./forget";
import type { RecallResult } from "./recall";
import type { RememberResult } from "./remember";
import type { TimelineEntry } from "./timeline";

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${iso.slice(11, 16)}`;
};

export function formatRemember(r: RememberResult): string {
  if (r.status === "duplicate") return `Already known. Linked to #${r.seq} (${r.id}); nothing new was written.`;
  const rel = r.relations.filter((x) => x.relation !== "duplicate");
  const lines = [`Saved as #${r.seq} (${r.id}), hash ${shortHash(r.hash)}.`];
  for (const x of rel) {
    if (x.relation === "supersedes") lines.push(`Supersedes #${x.seq}: ${x.reason}`);
    if (x.relation === "contradicts") lines.push(`Conflicts with #${x.seq}: ${x.reason} It is in the conflict inbox; mention it to the user.`);
    if (x.relation === "refines") lines.push(`Adds detail to #${x.seq}.`);
  }
  if (r.relateStatus === "pending") lines.push("Contradiction check is still running in the background.");
  return lines.join("\n");
}

export function formatRecall(r: RecallResult): string {
  const head = `${r.memories.length} ${r.memories.length === 1 ? "memory" : "memories"} (${r.asOf ? `as of ${when(r.asOf)} UTC${r.mode === "as-of-verified" ? ", replayed from the chain" : ""}` : "as of now"}).${r.conflicts ? ` ${r.conflicts} in conflict.` : ""}`;
  const lines = [head];
  for (const m of r.memories) {
    let tag: string;
    if (m.status === "forgotten") tag = `#${m.seq} erased`;
    else if (r.asOf) tag = `#${m.seq} ${m.validAtAsOf ? "valid then" : "not valid then"}${m.status === "superseded" && m.supersededBy ? `, superseded since by #${Number(m.supersededBy.slice(-12))}` : ""}`;
    else if (m.status === "superseded") tag = `#${m.seq} superseded${m.supersededBy ? ` by #${Number(m.supersededBy.slice(-12))}` : ""}`;
    else tag = `#${m.seq} valid`;
    if (m.conflict && m.status === "active") tag += `, conflicts with ${m.contradictedBy.map((c) => `#${Number(c.slice(-12))}`).join(", ")}`;
    const text = m.text ?? m.note ?? "(content erased)";
    lines.push(`[${tag}] ${text} (${m.agentName}, ${when(m.createdAt)})`);
  }
  if (r.integrity) {
    lines.push(r.integrity.status === "tampered"
      ? `Integrity: TAMPERED. ${r.integrity.firstFinding ?? ""} Verified only through #${r.integrity.validThrough}.`
      : `Integrity: verified through #${r.integrity.validThrough}${r.checkpoint ? `, checkpoint ${r.checkpoint.fileId} signed ${when(r.checkpoint.createdAt)}` : ""}.`);
  } else if (r.checkpoint) {
    lines.push(`Latest signed checkpoint: ${r.checkpoint.fileId} (${r.checkpoint.size} entries).`);
  }
  if (!r.memories.length) lines.push("Nothing relevant is stored yet.");
  return lines.join("\n");
}

export function formatForget(r: ForgetResult): string {
  return `Memory #${r.targetSeq} was erased. The record of erasure is entry #${r.seq} (${r.forgetEntryId}). The chain still verifies; the content cannot be recovered.${r.erased ? "" : " Erasure of the stored text is being retried in the background."}`;
}

export function formatTimeline(subject: string, entries: TimelineEntry[]): string {
  if (!entries.length) return `No memories about ${subject}.`;
  return [`${entries.length} entries about ${subject}, oldest first:`, ...entries.map((e) => {
    const what = e.op === "forget" ? `forgot #${e.target ? Number(e.target.slice(-12)) : "?"}` : e.op === "link" ? `resolved (${e.kind}) #${e.target ? Number(e.target.slice(-12)) : "?"}` : e.text ?? "(content erased)";
    return `#${e.seq} [${e.status}] ${what} (${e.agentName}, ${when(e.createdAt)})`;
  })].join("\n");
}

export function formatVerify(v: { status: string; integrity: string; validThrough: number; entries: number; checkpointsValid: number; findings: { seq: number; message: string; severity?: string }[]; proof?: { seq: number; checkpoint: { file: string; size: string }; path: string[] } }): string {
  const verified = `${v.entries} entries, valid through #${v.validThrough}, ${v.checkpointsValid} signed checkpoint${v.checkpointsValid === 1 ? "" : "s"} valid.`;
  const warning = v.findings.find((f) => f.severity === "warning") ?? v.findings[0];
  const lines = [v.status === "tampered" || v.integrity === "tampered"
    ? `TAMPERED. Valid only through #${v.validThrough}.`
    : v.status === "warning" || v.integrity === "warning"
      ? `Verified with warnings: ${verified}${warning ? ` First warning: ${warning.message}` : ""}`
      : `Verified: ${verified}`];
  for (const f of v.findings.slice(0, 5)) lines.push(`- #${f.seq}: ${f.message}`);
  if (v.proof) lines.push(`Inclusion proof for #${v.proof.seq}: ${v.proof.path.length} Merkle steps to the root of ${v.proof.checkpoint.file} (${Number(v.proof.checkpoint.size)} entries).`);
  return lines.join("\n");
}
