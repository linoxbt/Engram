import type { NextConfig } from "next";

const prod = process.env.NODE_ENV === "production";
const appwriteHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? "").host; } catch { return ""; }
})();

// Inline scripts stay allowed: Next.js bootstraps hydration with them, and the layout strips host-injected
// markup before hydration. Everything else is pinned to this origin, Google Fonts and Appwrite.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  `connect-src 'self' https://*.appwrite.io wss://*.appwrite.io${appwriteHost ? ` https://${appwriteHost} wss://${appwriteHost}` : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(prod ? ["upgrade-insecure-requests"] : []),
].join("; ");

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
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      { key: "Content-Security-Policy", value: csp },
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
      { source: "/api/v1/spaces/:key", headers: cors },
      { source: "/api/v1/spaces/:key/:rest*", headers: cors },
    ];
  },
};

export default config;
