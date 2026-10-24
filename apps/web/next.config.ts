import type { NextConfig } from "next";

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
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
