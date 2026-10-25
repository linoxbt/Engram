import { z } from "zod";
import { defer, readJson, route } from "@/lib/server/api";
import { clientIp, MINUTE, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const Body = z.object({
  kind: z.enum(["error", "unhandledrejection", "boundary"]),
  message: z.string().max(1000),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500),
  digest: z.string().max(100).optional(),
});

// Control and bidi characters out; backticks out so a value cannot leave its code span (markdown is inert inside);
// a zero-width space after "@" and "<" so @everyone, @here, <!channel>, <@id> and <#id> never resolve.
const clean = (s: string, max: number) =>
  s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ").replace(/`/g, "'").replace(/[@<]/g, "$&\u200b").trim().slice(0, max);

/**
 * Browser error reports. Written to the function logs as one JSON line (no IP address), and forwarded to
 * ERROR_WEBHOOK_URL when set, so a Slack or Discord channel hears about breakage as it happens.
 */
export const POST = route(async (req) => {
  rateLimit("telemetry-ip", clientIp(req), 30, 10 * MINUTE);
  const body = Body.parse(await readJson(req));
  const report = {
    kind: body.kind, message: clean(body.message, 300), stack: body.stack?.split("\n").map((l) => clean(l, 300)).join("\n").slice(0, 1500), url: clean(body.url, 200),
    digest: body.digest ? clean(body.digest, 100) : undefined, ua: clean(req.headers.get("user-agent") ?? "", 200) || null, at: new Date().toISOString(),
  };
  console.error(`[engram:client-error] ${JSON.stringify(report)}`);
  const hook = process.env.ERROR_WEBHOOK_URL;
  // Per-IP limits do not stop many addresses flooding the channel: a shared budget for forwarding, logs keep the rest.
  let forward = !!hook;
  try { if (hook) rateLimit("telemetry-hook", "all", 60, 10 * MINUTE); } catch { forward = false; }
  if (forward) {
    const text = `Engram ${report.kind} on \`${report.url}\`: \`${report.message}\``;
    defer(() => fetch(hook!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text, allowed_mentions: { parse: [] }, report }),
      signal: AbortSignal.timeout(5000),
    }));
  }
  return { ok: true };
});
