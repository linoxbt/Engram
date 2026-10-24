"use client";
import clsx from "clsx";
import { useMemo, useState } from "react";

const START = Date.parse("2026-10-19T06:00:00Z");
const END = Date.parse("2026-10-25T12:00:00Z");
const EVENTS = [
  { at: "2026-10-19T09:01:00Z", who: "onboarding-agent", text: "Ada is on the Pro plan, billed monthly.", kind: "plan" as const, until: "2026-10-22T11:15:00Z" },
  { at: "2026-10-19T09:02:00Z", who: "onboarding-agent", text: "Ada prefers email over phone calls.", kind: "pref" as const },
  { at: "2026-10-21T10:00:00Z", who: "support-agent", text: "Delivery address: 14 Palm Close, Lekki.", kind: "addr" as const, erased: "2026-10-24T09:30:00Z" },
  { at: "2026-10-22T11:15:00Z", who: "support-agent", text: "Ada downgraded from Pro to Basic.", kind: "plan" as const },
];
const fmt = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** "What did the agent know on Tuesday?" A miniature Time Machine over the demo story. */
export function TimeScrubber() {
  const [t, setT] = useState(Date.parse("2026-10-20T12:00:00Z"));
  const known = useMemo(() => EVENTS.filter((e) => Date.parse(e.at) <= t).map((e) => ({
    ...e,
    state: e.until && Date.parse(e.until) <= t ? "superseded" : e.erased && Date.parse(e.erased) <= t ? "erased" : "valid",
  })), [t]);
  const plan = known.filter((k) => k.kind === "plan" && k.state === "valid").pop();
  const frac = (t - START) / (END - START);
  return (
    <div className="l-glass p-5 sm:p-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="l-eyebrow">Ask the past</p>
        <p className="font-mono text-xs text-gold">as of {fmt(t)} UTC</p>
      </div>
      <p className="l-display mt-4 text-2xl sm:text-3xl">&ldquo;What plan is Ada on?&rdquo;</p>
      <p className="mt-3 text-lg">
        <span className="text-muted">The agent knew: </span>
        <span className={clsx("transition-colors", plan ? "text-cyan" : "text-muted")}>{plan ? (plan.text.includes("Basic") ? "Basic." : "Pro.") : "nothing yet."}</span>
      </p>

      <div className="relative mt-8 h-10">
        <div className="absolute inset-x-0 top-5 h-px bg-gradient-to-r from-cyan/10 via-cyan/40 to-violet/30" />
        {EVENTS.map((e) => (
          <span key={e.at} className="absolute top-2 h-6 w-px bg-cyan/70" style={{ left: `${((Date.parse(e.at) - START) / (END - START)) * 100}%` }} />
        ))}
        <span className="absolute top-2 h-6 w-px bg-muted" style={{ left: `${((Date.parse("2026-10-24T09:30:00Z") - START) / (END - START)) * 100}%` }} title="erasure" />
        <span aria-hidden className="pointer-events-none absolute top-[11px] size-[18px] -translate-x-1/2 rounded-full border-2 border-gold bg-bg shadow-[0_0_20px_rgba(217,180,74,.6)]" style={{ left: `${frac * 100}%` }} />
        <input type="range" aria-label="As of" min={START} max={END} step={15 * 60_000} value={t} onChange={(e) => setT(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-ew-resize opacity-0" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>19 Oct</span><span>22 Oct</span><span>25 Oct</span></div>

      <ul className="mt-6 space-y-2">
        {EVENTS.map((e) => {
          const k = known.find((x) => x.at === e.at);
          return (
            <li key={e.at} className={clsx("flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-sm transition-all duration-500",
              !k ? "l-hairline opacity-30" : k.state === "superseded" ? "l-hairline text-muted" : k.state === "erased" ? "border-dashed border-line-2 text-muted" : "border-cyan/25")}>
              <span className={clsx("prose-sans", k?.state === "superseded" && "line-through decoration-muted/60")}>
                {k?.state === "erased" ? "Content erased. Receipt kept." : e.text}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">{!k ? "not yet" : k.state}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
