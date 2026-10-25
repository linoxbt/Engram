"use client";
import clsx from "clsx";
import { SIG_TEXT, sigState, stepMarks, type ProofStep, type SigCheck } from "@/lib/client/proof";
import { shortHash } from "@/lib/format";
import { IconAlert, IconCross, IconSeal, IconTick } from "./icons";

/** Merkle walk steps. Nothing ticks until the verdict is known; a failed proof marks the root step. */
export function ProofSteps({ steps, shown = steps.length, rootOk }: { steps: ProofStep[]; shown?: number; rootOk: boolean | null }) {
  const marks = stepMarks(steps.length, rootOk);
  return (
    <ol className="space-y-1.5">
      {steps.slice(0, shown).map((s, i) => (
        <li key={i} className={clsx("panel flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-2xs anim-slide-in", marks[i] === "fail" && "border-tamper/60")} data-mark={marks[i]}>
          {marks[i] === "ok" ? <IconTick size={11} className="text-valid" aria-label="verified" />
            : marks[i] === "fail" ? <IconCross size={11} className="text-tamper" aria-label="does not match the checkpoint root" />
              : <span className="inline-block size-[11px] rounded-full border border-line-2" aria-hidden />}
          <span className="w-16 text-muted">{s.label}</span>
          {s.sibling && <span className="text-muted">{s.side === "L" ? "← " : "→ "}{shortHash(s.sibling)}</span>}
          <span className="ml-auto tabular">{shortHash(s.hash)}</span>
          {marks[i] === "fail" && <span className="basis-full text-tamper">This is not the signed root.</span>}
        </li>
      ))}
    </ol>
  );
}

/** Root and signature verdict. Gold only when the root matches and the signature was checked with a built-in key. */
export function ProofVerdict({ rootOk, sig, className }: { rootOk: boolean; sig: SigCheck; className?: string }) {
  const s = sigState(sig);
  const tone = !rootOk || s === "invalid" ? "tampered" : s === "valid" ? "sealed" : "warning";
  return (
    <div className={clsx("rounded-[2px] border px-3 py-2 text-xs", tone === "sealed" && "border-gold/60 text-gold anim-stamp", tone === "warning" && "border-warn/60 text-warn", tone === "tampered" && "border-tamper/60 text-tamper", className)} data-tone={tone}>
      {tone === "sealed" ? <IconSeal className="mr-1 inline" /> : tone === "warning" ? <IconAlert className="mr-1 inline" /> : <IconCross className="mr-1 inline" />}
      {rootOk ? "Root matches the signed checkpoint. " : "Root does not match the checkpoint. "}
      {SIG_TEXT[s]}
    </div>
  );
}
