/** Shared by the cookie banner and the server: one cookie records the visitor's choice for a year. */
export const CONSENT_COOKIE = "engram_consent";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;
export type Consent = "accepted" | "declined";
export const COOKIES_REQUIRED_MESSAGE = "Engram needs cookies to keep you signed in. Accept cookies to continue.";
