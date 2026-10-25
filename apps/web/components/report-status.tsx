"use client";
import clsx from "clsx";
import type { Finding, Report } from "@engram/core";
import { reportHeadline, type Tone } from "@/lib/client/report-copy";
import { IconAlert, IconTick } from "./icons";
import { Pill } from "./ui";

export const toneText = (t: Tone) => (t === "valid" ? "text-valid" : t === "warning" ? "text-warn" : "text-tamper");

/** The verdict line: green only when nothing at all was flagged; amber for warnings; red for tampering. */
export function ReportVerdict({ report, size = 20, suffix, className }: { report: Report; size?: number; suffix?: string; className?: string }) {
  const h = reportHeadline(report);
  return (
    <div className={clsx("flex items-start gap-2", toneText(h.tone), className)} data-status={report.status}>
      {h.tone === "valid" ? <IconTick size={size} className="mt-0.5 shrink-0" /> : <IconAlert size={size} className="mt-0.5 shrink-0" />}
      <span>{h.text}{suffix ? ` ${suffix}` : ""}</span>
    </div>
  );
}

/** Critical findings first, then warnings, so an amber result always says what the warning is. */
export function FindingsList({ findings, limit = 8, onSeq }: { findings: Finding[]; limit?: number; onSeq?: (seq: number) => void }) {
  const shown = findings.filter((f) => f.severity !== "info").sort((a, b) => (a.severity === b.severity ? a.seq - b.seq : a.severity === "critical" ? -1 : 1));
  if (!shown.length) return null;
  return (
    <ul className="border-t border-line text-xs">
      {shown.slice(0, limit).map((f, i) => (
        <li key={i} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-5 py-2">
          <Pill tone={f.severity === "critical" ? "tampered" : "warning"}>{f.severity}</Pill>
          {onSeq ? <button className={clsx("tabular hover:underline", f.severity === "critical" ? "text-tamper" : "text-warn")} onClick={() => onSeq(f.seq)}>#{f.seq}</button>
            : <span className={clsx("tabular", f.severity === "critical" ? "text-tamper" : "text-warn")}>#{f.seq}</span>}
          <span className="text-muted">{f.rule}</span>
          <span className="min-w-0 flex-1 basis-60">{f.message}</span>
        </li>
      ))}
      {shown.length > limit && <li className="px-5 py-2 text-2xs text-muted">and {shown.length - limit} more</li>}
    </ul>
  );
}
