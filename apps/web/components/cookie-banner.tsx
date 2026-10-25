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

  // A slim bar along the bottom edge: short enough that it never covers the hero's calls to action.
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="cookie-title" aria-describedby="cookie-text"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-line-2 bg-bg/95 shadow-[0_-12px_40px_-24px_rgba(10,10,10,.35)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-6 sm:py-3">
        <p className="min-w-0 flex-1 font-sans text-[12.5px] leading-snug text-muted">
          <span id="cookie-title" className="font-semibold text-text">Engram uses cookies</span>{" "}
          <span id="cookie-text">only to keep you signed in and remember this choice. No advertising or tracking. Declining still lets you browse, but signing in stays off until you accept.</span>{" "}
          <span className="whitespace-nowrap"><Link href="/legal/cookies" className="text-text underline underline-offset-2">Cookie Policy</Link> · <Link href="/legal/privacy" className="text-text underline underline-offset-2">Privacy Policy</Link> · <Link href="/legal/terms" className="text-text underline underline-offset-2">Terms of Service</Link></span>
        </p>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => void decline()} className="h-8 flex-1 rounded-full border border-line-2 px-4 font-sans text-[13px] font-medium text-text hover:border-accent sm:flex-none">Decline</button>
          <button onClick={accept} className="h-8 flex-1 rounded-full bg-accent px-4 font-sans text-[13px] font-medium text-bg hover:bg-accent/85 sm:flex-none">Accept</button>
        </div>
      </div>
    </div>
  );
}
