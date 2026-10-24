"use client";
import { useEffect, useState } from "react";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, type Consent } from "@/lib/consent";

const EVENT = "engram:consent";
export const OPEN_COOKIE_SETTINGS = "engram:cookie-settings";

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(accepted|declined)`));
  return (m?.[1] as Consent | undefined) ?? null;
}

export function writeConsent(value: Consent) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

/** The visitor's cookie choice: undefined until read on the client, null when they have not chosen. */
export function useConsent(): Consent | null | undefined {
  const [value, setValue] = useState<Consent | null | undefined>(undefined);
  useEffect(() => {
    setValue(readConsent());
    const on = () => setValue(readConsent());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return value;
}

export const openCookieSettings = () => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS));
