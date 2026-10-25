"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { readConsent, writeConsent } from "@/lib/client/consent";

/**
 * "Explore the live demo": the server makes a temporary read-only guest account in the demo space and signs it in.
 * A session is a cookie, so the visitor must accept essential cookies first.
 */
export function DemoButton({ className }: { className?: string }) {
  const [state, setState] = useState<"idle" | "consent" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const enter = async () => {
    setState("loading"); setError(null);
    try {
      const r = await api<{ ok: boolean; space: string }>("/api/demo/enter", { method: "POST" });
      // A full navigation, so the server-rendered app sees the new session cookie.
      window.location.assign(`/app/${encodeURIComponent(r.space)}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "cookies_required") { setState("consent"); return; }
      setError(e instanceof ApiError && e.status === 429 ? "Too many demo visits from this network right now. Try again in a few minutes." : e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  };
  const start = () => { if (readConsent() !== "accepted") setState("consent"); else void enter(); };
  return (
    <div className="contents">
      <button type="button" onClick={start} disabled={state === "loading"} aria-expanded={state === "consent"} className={className}>
        {state === "loading" ? "Opening the demo…" : "Explore the live demo (read-only)"}
      </button>
      {state === "consent" && (
        <div role="dialog" aria-label="Cookies for the demo" className="basis-full rounded-2xl border border-line-2 bg-bg p-4 font-sans text-[13px] text-muted">
          <p>The demo signs you in as a temporary guest for 24 hours, which needs Engram&apos;s essential cookies (a session and your cookie choice). No tracking.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { writeConsent("accepted"); void enter(); }} className="h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-bg hover:bg-accent/85">Accept cookies and open the demo</button>
            <button type="button" onClick={() => setState("idle")} className="h-9 rounded-full border border-line-2 px-4 text-[13px] text-text hover:border-accent">Not now</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="basis-full font-sans text-[13px] text-tamper">{error}</p>}
    </div>
  );
}
