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

  // Compact, and on wide screens in the bottom-right corner, so it never covers the hero's calls to action.
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="cookie-title" aria-describedby="cookie-text"
      className="fixed inset-x-2 bottom-2 z-[70] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-w-sm">
      <div className="rounded-2xl border border-line-2 bg-bg px-4 py-3 shadow-[0_24px_60px_-20px_rgba(10,10,10,.35)] sm:p-5">
        <p id="cookie-title" className="font-sans text-sm font-semibold text-text">Engram uses cookies</p>
        <p id="cookie-text" className="mt-1 font-sans text-[12.5px] leading-snug text-muted sm:mt-2 sm:text-[13px] sm:leading-relaxed">
          Only essential cookies: one keeps you signed in, one remembers this choice. No advertising or tracking. Declining still lets you browse, but signing in stays off until you accept.
        </p>
        <p className="mt-1 font-sans text-[12px] text-muted sm:mt-2">
          <Link href="/legal/cookies" className="text-text underline underline-offset-2">Cookie Policy</Link> · <Link href="/legal/privacy" className="text-text underline underline-offset-2">Privacy Policy</Link> · <Link href="/legal/terms" className="text-text underline underline-offset-2">Terms of Service</Link>
        </p>
        <div className="mt-2.5 flex gap-2 sm:mt-4">
          <button onClick={() => void decline()} className="h-8 flex-1 rounded-full border border-line-2 font-sans text-[13px] font-medium text-text hover:border-accent sm:h-9">Decline</button>
          <button onClick={accept} className="h-8 flex-1 rounded-full bg-accent font-sans text-[13px] font-medium text-bg hover:bg-accent/85 sm:h-9">Accept</button>
        </div>
      </div>
    </div>
  );
}
