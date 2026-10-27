import { NextResponse, type NextRequest } from "next/server";
import { newNonce, pageCsp } from "./lib/csp";
import { requestIdFor } from "./lib/server/log";

/**
 * A per-request CSP nonce and request ID for every page. Next.js reads the nonce from the request's
 * Content-Security-Policy header and puts it on its own scripts; the root layout puts it on its one inline
 * script. Every page renders per request (the layout reads the request headers), so no cached HTML carries a
 * stale nonce.
 */
export function proxy(req: NextRequest) {
  const nonce = newNonce();
  const csp = pageCsp({ nonce, dev: process.env.NODE_ENV === "development", appwriteEndpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  // The API wrappers stamp this on every response; without it here a report about a page has nothing to join on.
  res.headers.set("x-request-id", requestIdFor(req.headers));
  return res;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes get their own fixed policy (next.config.ts), static files need none.
      source: "/((?!api/|_next/static|_next/image|favicon\\.ico|icon\\.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
