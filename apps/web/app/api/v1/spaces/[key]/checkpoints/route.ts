import { getBackend, loadCheckpoints } from "@engram/server";
import { json, route } from "@/lib/server/api";
import { publicSpace } from "@/lib/server/public";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const GET = route<{ key: string }>(async (req, { key }) => {
  rateLimit("public-v1", clientIp(req), 120, MINUTE, "Too many requests.");
  await publicSpace(key);
  return json({ checkpoints: await loadCheckpoints(getBackend(), key) }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60", "Netlify-Vary": "query" } });
});
