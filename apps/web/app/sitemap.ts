import type { MetadataRoute } from "next";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const PUBLIC = ["", "/docs", "/docs/concepts", "/docs/mcp", "/docs/api", "/docs/deploy", "/verify", "/login", "/signup", "/legal/terms", "/legal/privacy", "/legal/cookies"];

export default function sitemap(): MetadataRoute.Sitemap {
  const demo = process.env.NEXT_PUBLIC_DEMO_SPACE;
  return [...PUBLIC, ...(demo ? [`/verify/${demo}`] : [])].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p === "" || p.startsWith("/verify/") ? "daily" : "monthly",
    priority: p === "" ? 1 : p.startsWith("/docs") ? 0.7 : 0.5,
  }));
}
