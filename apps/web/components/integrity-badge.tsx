"use client";
import clsx from "clsx";
import { IconAlert, IconShield, IconTick } from "./icons";
import { ago, when } from "@/lib/format";

export interface Integrity { status: "valid" | "warning" | "tampered"; validThrough: number; entries: number; checkedAt: string; firstFinding: string | null; critical?: number }

/**
 * The stored result of the last verification. Green only for a clean result that still covers the head; a result
 * with warnings is amber, and one computed before newer entries were written says how far behind it is.
 */
export function IntegrityBadge({ integrity, checkpoint, size = "md", onVerify, stale = 0 }: {
  integrity: Integrity | null | undefined;
  checkpoint?: { createdAt: string; size: number } | null;
  size?: "sm" | "md" | "lg";
  onVerify?: () => void;
  /** Entries written since this result was computed. */
  stale?: number;
}) {
  if (!integrity) {
    return (
      <div className={clsx("inline-flex items-center gap-2 rounded-[2px] border border-line-2 px-2 text-muted", size === "lg" ? "py-3" : "h-7 text-xs")}>
        <IconShield /> Not verified yet
        {onVerify && <button onClick={onVerify} className="text-accent hover:underline">verify now</button>}
      </div>
    );
  }
  const behind = stale > 0 && integrity.status !== "tampered";
  const tone = integrity.status === "tampered" ? "tamper" : integrity.status === "warning" ? "warn" : behind ? "muted" : "valid";
  const Icon = integrity.status === "valid" ? (behind ? IconShield : IconTick) : IconAlert;
  const text = integrity.status === "valid"
    ? `Verified through #${integrity.validThrough}`
    : integrity.status === "warning"
      ? `Hashes verify through #${integrity.validThrough}, with warnings`
      : `Tampered at #${integrity.validThrough + 1}`;
  const staleText = behind ? `checked ${stale} ${stale === 1 ? "entry" : "entries"} ago` : null;
  if (size === "lg") {
    return (
      <div className={clsx("card px-5 py-4", integrity.status === "tampered" && "border-tamper/50")} data-state={tone === "valid" ? "valid" : tone === "warn" || tone === "muted" ? "warning" : "tampered"}>
        <div className={clsx("flex items-center gap-3 text-xl", tone === "valid" && "text-valid", tone === "warn" && "text-warn", tone === "tamper" && "text-tamper", tone === "muted" && "text-text")}>
          <Icon size={22} className="shrink-0" /> {text}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {integrity.status === "valid"
            ? `${integrity.entries} entries.${checkpoint ? ` Signed ${when(checkpoint.createdAt)}.` : ""} Checked ${ago(integrity.checkedAt)}.`
            : `${integrity.firstFinding ?? ""} Checked ${ago(integrity.checkedAt)}.`}
          {staleText && <span className="text-warn"> {stale} newer {stale === 1 ? "entry is" : "entries are"} not covered yet.</span>}
        </p>
        {onVerify && <button onClick={onVerify} className="mt-2 text-xs text-accent hover:underline">Run verification in this browser →</button>}
      </div>
    );
  }
  return (
    <div title={[integrity.firstFinding, staleText && `Last checked ${ago(integrity.checkedAt)}; ${staleText}.`].filter(Boolean).join(" ") || undefined}
      className={clsx("inline-flex h-7 max-w-full items-center gap-1.5 rounded-[2px] border px-2 text-xs",
        tone === "valid" && "border-valid/50 text-valid", tone === "warn" && "border-warn/50 text-warn", tone === "tamper" && "border-tamper/60 bg-tamper/10 text-tamper", tone === "muted" && "border-line-2 text-text")}>
      <Icon size={12} className="shrink-0" /> <span className="truncate">{text}{staleText && <span className="text-muted"> · {staleText}</span>}</span>
    </div>
  );
}
