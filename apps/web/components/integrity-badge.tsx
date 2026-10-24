"use client";
import clsx from "clsx";
import { IconAlert, IconShield, IconTick } from "./icons";
import { ago, when } from "@/lib/format";

export interface Integrity { status: "valid" | "warning" | "tampered"; validThrough: number; entries: number; checkedAt: string; firstFinding: string | null; critical?: number }

export function IntegrityBadge({ integrity, checkpoint, size = "md", onVerify }: {
  integrity: Integrity | null | undefined;
  checkpoint?: { createdAt: string; size: number } | null;
  size?: "sm" | "md" | "lg";
  onVerify?: () => void;
}) {
  if (!integrity) {
    return (
      <div className={clsx("inline-flex items-center gap-2 rounded-[2px] border border-line-2 px-2 text-muted", size === "lg" ? "py-3" : "h-7 text-xs")}>
        <IconShield /> Not verified yet
        {onVerify && <button onClick={onVerify} className="text-cyan hover:underline">verify now</button>}
      </div>
    );
  }
  const tone = integrity.status === "valid" ? "valid" : integrity.status === "warning" ? "warn" : "tamper";
  const Icon = integrity.status === "valid" ? IconTick : integrity.status === "warning" ? IconAlert : IconAlert;
  const text = integrity.status === "valid"
    ? `Verified through #${integrity.validThrough}`
    : integrity.status === "warning"
      ? "Derived mismatch"
      : `Tampered at #${integrity.validThrough + 1}`;
  if (size === "lg") {
    return (
      <div className={clsx("card px-5 py-4", integrity.status === "tampered" && "border-tamper/50")} data-state={integrity.status === "valid" ? "valid" : integrity.status === "warning" ? "warning" : "tampered"}>
        <div className={clsx("flex items-center gap-3 text-xl", tone === "valid" && "text-valid", tone === "warn" && "text-warn", tone === "tamper" && "text-tamper")}>
          <Icon size={22} /> {text}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {integrity.status === "valid"
            ? `${integrity.entries} entries.${checkpoint ? ` Signed ${when(checkpoint.createdAt)}.` : ""} Checked ${ago(integrity.checkedAt)}.`
            : `${integrity.firstFinding ?? ""} Checked ${ago(integrity.checkedAt)}.`}
        </p>
        {onVerify && <button onClick={onVerify} className="mt-2 text-xs text-cyan hover:underline">Run verification in this browser →</button>}
      </div>
    );
  }
  return (
    <div title={integrity.firstFinding ?? undefined} className={clsx("inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-xs",
      tone === "valid" && "border-valid/50 text-valid", tone === "warn" && "border-warn/50 text-warn", tone === "tamper" && "border-tamper/60 bg-tamper/10 text-tamper")}>
      <Icon size={12} /> {text}
    </div>
  );
}
