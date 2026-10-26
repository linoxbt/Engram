import { getBackend, proofFor } from "@engram/server";
import { json, route } from "@/lib/server/api";
import { publicSpace } from "@/lib/server/public";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
/**
 * Public inclusion proof: hashes only, never text. It is made against the latest checkpoint; a caller that names
 * that checkpoint (`?checkpoint=<seq>`) gets a response that never changes, so the CDN may keep it for a day.
 */
export const GET = route<{ key: string; id: string }>(async (req, { key, id }) => {
  rateLimit("public-v1", clientIp(req), 120, MINUTE, "Too many requests.");
  const proof = await proofFor(getBackend(), await publicSpace(key), id);
  const asked = req.nextUrl.searchParams.get("checkpoint");
  const pinned = asked != null && /^\d{1,12}$/.test(asked) && Number(asked) === Number(proof.checkpoint.seq);
  return json(proof, { headers: { "Cache-Control": pinned ? "public, max-age=3600, s-maxage=86400, immutable" : "public, max-age=0, s-maxage=60", "Netlify-Vary": "query" } });
});
