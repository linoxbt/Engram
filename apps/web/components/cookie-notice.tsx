"use client";
import { writeConsent } from "@/lib/client/consent";
import { COOKIES_REQUIRED_MESSAGE } from "@/lib/consent";

/** Inline on auth forms when the visitor has not accepted cookies, which signing in requires. */
export function CookieNotice() {
  return (
    <div role="alert" className="rounded-[2px] border border-warn/50 bg-warn/5 px-3 py-2.5 text-xs">
      <p className="text-warn">{COOKIES_REQUIRED_MESSAGE}</p>
      <button type="button" onClick={() => writeConsent("accepted")} className="mt-2 inline-flex h-7 items-center rounded-[2px] bg-accent px-3 text-2xs text-bg">Accept cookies</button>
    </div>
  );
}
