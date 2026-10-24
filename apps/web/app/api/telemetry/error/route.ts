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

/**
 * Browser error reports. Written to the function logs as one JSON line (no IP address), and forwarded to
 * ERROR_WEBHOOK_URL when set, so a Slack or Discord channel hears about breakage as it happens.
 */
export const POST = route(async (req) => {
  rateLimit("telemetry-ip", clientIp(req), 30, 10 * MINUTE);
  const report = { ...Body.parse(await readJson(req)), ua: req.headers.get("user-agent")?.slice(0, 200) ?? null, at: new Date().toISOString() };
  console.error(`[engram:client-error] ${JSON.stringify(report)}`);
  const hook = process.env.ERROR_WEBHOOK_URL;
  if (hook) {
    defer(() => fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Engram ${report.kind} on ${report.url}: ${report.message}`, content: `Engram ${report.kind} on ${report.url}: ${report.message}`, report }),
    }));
  }
  return { ok: true };
});
