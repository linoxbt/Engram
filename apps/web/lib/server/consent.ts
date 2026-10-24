import "server-only";
import type { NextRequest } from "next/server";
import { EngramError } from "@engram/server";
import { CONSENT_COOKIE, COOKIES_REQUIRED_MESSAGE } from "@/lib/consent";

/** Signing in sets a session cookie, so it waits for the visitor's consent. */
export function requireCookieConsent(req: NextRequest) {
  if (req.cookies.get(CONSENT_COOKIE)?.value !== "accepted") throw new EngramError("cookies_required", COOKIES_REQUIRED_MESSAGE);
}

/** Where email links send people back to: the configured public URL, so it matches Appwrite's platform list. */
export function appOrigin(req: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
}
