"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OPEN_COOKIE_SETTINGS, useConsent, writeConsent } from "@/lib/client/consent";

/**
 * Asks once, remembers for a year. Engram sets only first-party cookies (the session and this choice)
 * and no advertising or analytics cookies; declining signs the visitor out, since a session is a cookie.
 */
export function CookieBanner() {
  const consent = useConsent();
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = usePathname();
  const [reopened, setReopened] = useState(false);
  useEffect(() => {
    const on = () => setReopened(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS, on);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, on);
  }, []);
  if (consent === undefined || (consent !== null && !reopened)) return null;

  const accept = () => { writeConsent("accepted"); setReopened(false); };
  const decline = async () => {
    writeConsent("declined");
    setReopened(false);
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    qc.clear();
    if (pathname.startsWith("/app")) router.push("/");
    router.refresh();
  };

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="cookie-title" aria-describedby="cookie-text"
      className="fixed inset-x-3 bottom-3 z-[70] sm:inset-x-auto sm:bottom-5 sm:left-5 sm:max-w-sm">
      <div className="rounded-2xl border border-line-2 bg-bg p-5 shadow-[0_24px_60px_-20px_rgba(10,10,10,.35)]">
        <p id="cookie-title" className="font-sans text-sm font-semibold text-text">Engram uses cookies</p>
        <p id="cookie-text" className="mt-2 font-sans text-[13px] leading-relaxed text-muted">
          We use a few essential cookies to keep you signed in and remember this choice. No advertising or tracking cookies. Engram needs them to sign you in; if you decline, you can still browse, but signing in stays off until you accept.
        </p>
        <p className="mt-2 font-sans text-[12px] text-muted">
          Read our <Link href="/legal/cookies" className="text-text underline underline-offset-2">Cookie Policy</Link>, <Link href="/legal/privacy" className="text-text underline underline-offset-2">Privacy Policy</Link> and <Link href="/legal/terms" className="text-text underline underline-offset-2">Terms of Service</Link>.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => void decline()} className="h-9 flex-1 rounded-full border border-line-2 font-sans text-[13px] font-medium text-text hover:border-accent">Decline</button>
          <button onClick={accept} className="h-9 flex-1 rounded-full bg-accent font-sans text-[13px] font-medium text-bg hover:bg-accent/85">Accept</button>
        </div>
      </div>
    </div>
  );
}
