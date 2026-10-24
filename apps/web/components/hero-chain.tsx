"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";

/** Looping hero: blocks join the chain, one is edited, the chain turns red at that block, then heals. */
export function HeroChain() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setT(14); return; }
    const id = setInterval(() => setT((x) => (x + 1) % 22), 420);
    return () => clearInterval(id);
  }, []);
  const n = Math.min(9, t + 1);
  const edited = t >= 11 && t < 19;
  const broken = t >= 13 && t < 19;
  return (
    <div className="card overflow-hidden p-5" data-state={broken ? "tampered" : t >= 9 && t < 11 ? "sealed" : "valid"} aria-hidden>
      <div className="mb-3 flex items-center justify-between text-2xs">
        <span className="label">space k7m2q9xa</span>
        <span className={clsx(broken ? "text-tamper" : "text-valid")}>{broken ? "Memory #4 was changed after it was written." : `Verified through #${n - 1}`}</span>
      </div>
      <div className="flex items-center">
        {Array.from({ length: 9 }, (_, i) => {
          const shown = i < n;
          const bad = broken && i >= 4;
          return (
            <div key={i} className="flex items-center">
              {i > 0 && <span className={clsx("h-px w-3 transition-colors sm:w-5", !shown ? "bg-transparent" : bad && i === 5 ? "bg-tamper" : "bg-line-2")} />}
              <div className={clsx("relative flex h-12 w-8 items-center justify-center rounded-[2px] border-2 text-[10px] transition-all duration-300 sm:w-10",
                !shown && "scale-75 opacity-0", shown && "opacity-100",
                bad && i === 4 ? "border-tamper bg-tamper/25 text-tamper anim-flash" : bad ? "border-tamper/40 text-tamper/60" : i === 4 && edited ? "border-warn text-warn" : "border-cyan bg-cyan/10 text-cyan")}>
                #{i}
                {i === 7 && shown && t >= 9 && <span className="absolute -top-4 text-gold anim-stamp">◆</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-muted">
        <div>prevHash → hash</div><div className="text-center">salted content hash</div><div className="text-right text-gold">signed Merkle root</div>
      </div>
    </div>
  );
}
