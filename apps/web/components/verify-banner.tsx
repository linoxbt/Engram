"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";

/** Shown across the app until the account's email address is confirmed. */
export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const resend = async () => {
    setState("sending"); setError(null);
    try {
      const r = await api<{ devLink?: string }>("/api/auth/verification", { method: "POST" });
      setDevLink(r.devLink ?? null);
      setState("sent");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setState("idle"); }
  };
  return (
    <div className="border-b border-warn/30 bg-warn/5 px-4 py-2 text-xs">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-warn">Verify your email address.</span>
        <span className="text-muted">{state === "sent" ? `A new link is on its way to ${email}.` : `We sent a link to ${email}.`}</span>
        {state !== "sent" && <button onClick={() => void resend()} disabled={state === "sending"} className="text-text underline underline-offset-2 disabled:opacity-50">{state === "sending" ? "Sending…" : "Resend"}</button>}
        {devLink && <a href={devLink} className="text-text underline underline-offset-2">Open link (local backend)</a>}
        {error && <span className="text-tamper">{error}</span>}
      </div>
    </div>
  );
}
