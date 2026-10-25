/**
 * Request IDs and structured error logs (no Next.js imports, so it is unit-testable). Every API response carries
 * `x-request-id`; every 5xx is one JSON line `{level:"error",reqId,route,status,code,message}` in the function logs.
 */

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Reuse an upstream ID (a caller's x-request-id, or Netlify's) when it is safe to echo, else a fresh UUID. */
export function requestIdFor(headers: Headers): string {
  for (const h of ["x-request-id", "x-nf-request-id"]) {
    const v = headers.get(h)?.trim();
    if (v && SAFE_ID.test(v)) return v;
  }
  return crypto.randomUUID();
}

export interface ErrorLine { reqId: string; route: string; status: number; code: string; message: string }

export function errorLine(f: ErrorLine): string {
  return JSON.stringify({ level: "error", reqId: f.reqId, route: f.route, status: f.status, code: f.code, message: f.message });
}

export function logError(f: ErrorLine) {
  console.error(errorLine(f));
}
