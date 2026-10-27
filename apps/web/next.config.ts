import type { NextConfig } from "next";
import { API_CSP, PREFETCH_CSP } from "./lib/csp";

const prod = process.env.NODE_ENV === "production";

// Pages get a per-request nonce policy from proxy.ts (no 'unsafe-inline' scripts, Appwrite pinned to the configured
// endpoint, fonts self-hosted). API responses get a fixed deny-all policy here; one route never gets both.
// proxy.ts skips router prefetches, so those are the one page response left without a policy: they get the
// fixed PREFETCH_CSP here, matched on the very headers that make the middleware stand aside.
const PAGES = "/((?!api/|_next/static|_next/image|favicon\\.ico|icon\\.svg).*)";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@engram/core", "@engram/server"],
  serverExternalPackages: ["node-appwrite"],
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
    ];
    const cors = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Content-Type" },
    ];
    return [
      { source: "/:path*", headers: security },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
      ...["next-router-prefetch", "purpose"].map((key) => ({
        source: PAGES,
        has: [{ type: "header" as const, key, ...(key === "purpose" ? { value: "prefetch" } : {}) }],
        headers: [{ key: "Content-Security-Policy", value: PREFETCH_CSP }],
      })),
      { source: "/api/v1/spaces/:key", headers: cors },
      { source: "/api/v1/spaces/:key/:rest*", headers: cors },
    ];
  },
};

export default config;
