/**
 * Content Security Policy (no Next.js imports, so it is unit-testable). Pages get a fresh nonce per request from
 * proxy.ts and Next.js puts it on its own scripts; nothing inline runs without it, and 'strict-dynamic' lets those
 * scripts load the app's chunks. Styles keep 'unsafe-inline' (React style attributes and next/font need it; CSS
 * cannot run script). Fonts are self-hosted by next/font, so no Google hosts are allowed. Appwrite is reachable only
 * at the configured endpoint's exact host (HTTP and its WebSocket for Realtime), never any *.appwrite.io project.
 */

/** The browser-facing Appwrite origins: the endpoint's scheme and its WebSocket twin, or none when unset. */
export function appwriteOrigins(endpoint: string | null | undefined): string[] {
  if (!endpoint) return [];
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" && u.protocol !== "http:") return [];
    return [`${u.protocol}//${u.host}`, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`];
  } catch { return []; }
}

export function pageCsp(opts: { nonce: string; dev: boolean; appwriteEndpoint?: string | null }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    ["connect-src 'self'", ...appwriteOrigins(opts.appwriteEndpoint)].join(" "),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(opts.dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** API responses are data, never documents: nothing may load or frame them. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** 128 random bits, base64. */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
