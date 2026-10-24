/**
 * Scripted agent over MCP, using the official MCP client SDK.
 *
 *   ENGRAM_URL=https://your-engram.app ENGRAM_KEY=eng_... pnpm demo-agent [smoke|story]
 *
 * smoke: list tools, remember, recall, timeline, verify (used as an end-to-end check)
 * story: the billing agent's beats from the demo story
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = process.env.ENGRAM_URL ?? "http://localhost:3000";
const key = process.env.ENGRAM_KEY;
const scenario = process.argv[2] ?? "smoke";
if (!key) { console.error("Set ENGRAM_KEY to an agent key (eng_...)."); process.exit(1); }

const transport = new StreamableHTTPClientTransport(new URL(`${url}/api/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${key}` } },
});
const client = new Client({ name: "engram-demo-agent", version: "1.0.0" });
await client.connect(transport);

type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = res.content?.map((c) => c.text ?? "").join("\n") ?? "";
  console.log(`\n▶ ${name} ${JSON.stringify(args)}\n${text}`);
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  return res.structuredContent ?? {};
}

const tools = await client.listTools();
console.log(`Connected to ${url}/api/mcp · tools: ${tools.tools.map((t) => t.name).join(", ")}`);

if (scenario === "smoke") {
  const stamp = new Date().toISOString();
  const r = await call("remember", { text: `Smoke test memory written at ${stamp}.`, subject: "system:smoke", kind: "observation", importance: 2, idempotencyKey: `smoke-${stamp}` });
  await call("recall", { query: "smoke test memory", k: 3, subject: "system:smoke" });
  await call("timeline", { subject: "system:smoke", limit: 5 });
  await call("verify", {});
  if (!r.id) throw new Error("remember returned no id");
} else if (scenario === "story") {
  await call("recall", { query: "Ada emailed. What plan is she on and how should I reply?", k: 5 });
  await call("recall", { query: "What plan is Ada on?", asOf: "2026-10-20T12:00:00.000Z", k: 3 });
  await call("timeline", { subject: "customer:ada" });
  await call("verify", {});
} else {
  console.error(`Unknown scenario ${scenario}`);
  process.exit(1);
}
await client.close();
console.log("\n✓ done");
