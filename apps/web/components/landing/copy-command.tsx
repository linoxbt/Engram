"use client";
import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="l-glass l-scan overflow-hidden !rounded-2xl">
      <div className="flex items-center gap-1.5 border-b l-hairline px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-tamper/70" /><span className="size-2.5 rounded-full bg-warn/70" /><span className="size-2.5 rounded-full bg-valid/70" />
        <span className="ml-3 font-mono text-[11px] text-muted">terminal</span>
        <button onClick={async () => { try { await navigator.clipboard.writeText(command); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* blocked */ } }}
          className="ml-auto font-mono text-[11px] text-cyan hover:underline">{done ? "copied" : "copy"}</button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed"><code><span className="text-muted">$ </span>{command}</code></pre>
    </div>
  );
}
