import { EngramError, timeline } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = agentRoute<{ subject: string }>("recall", async (ctx, req, { subject }) => {
  const q = req.nextUrl.searchParams;
  const cursor = q.get("cursor") ?? undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(subject); } catch { throw new EngramError("bad_request", "The subject in the URL is not valid percent-encoding."); }
  return timeline(ctx, { subject: decoded, limit: Number(q.get("limit") ?? 100), ...(cursor ? { cursor } : {}) });
});
