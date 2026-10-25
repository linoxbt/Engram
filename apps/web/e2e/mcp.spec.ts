import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/**
 * The MCP server end to end, with the official MCP client SDK over Streamable HTTP: an account, a space and an agent
 * key are created through the API, then every tool is called with the key as a bearer token.
 */
type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: Record<string, any> };

test("an agent remembers, recalls, resolves, forgets, verifies and reads the timeline over MCP", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
  const email = `mcp-${Date.now()}@example.com`;
  const signup = await page.request.post("/api/auth/signup", { data: { email, password: "password123", name: "MCP", acceptTerms: true } });
  expect(signup.ok(), await signup.text()).toBe(true);
  const space = await page.request.post("/api/app/spaces", { data: { name: "MCP space" } });
  expect(space.ok(), await space.text()).toBe(true);
  const { key: spaceKey } = await space.json();
  const agent = await page.request.post(`/api/app/spaces/${spaceKey}/agents`, {
    data: { name: "mcp-e2e", description: "MCP end-to-end test agent", scopes: ["remember", "recall", "forget", "verify", "resolve"] },
  });
  expect(agent.ok(), await agent.text()).toBe(true);
  const { key } = await agent.json();
  expect(key).toMatch(/^eng_/);

  const client = new Client({ name: "engram-e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseURL}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as ToolResult;
    const text = res.content?.map((c) => c.text ?? "").join("\n") ?? "";
    expect(res.isError, `${name}: ${text}`).toBeFalsy();
    return { text, data: res.structuredContent ?? {} };
  };

  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["forget", "recall", "remember", "resolve", "timeline", "verify"]);

    const pro = await call("remember", { text: "Ada is on the Pro plan.", subject: "customer:ada", kind: "fact", importance: 7 });
    expect(pro.data).toMatchObject({ status: "created", seq: 0 });
    const ent = await call("remember", { text: "Ada is on the Enterprise plan.", subject: "customer:ada", kind: "fact", importance: 7 });
    expect(ent.data.status).toBe("created");
    expect(ent.data.relations).toEqual(expect.arrayContaining([expect.objectContaining({ id: pro.data.id, relation: "contradicts" })]));
    const address = await call("remember", { text: "Ada's delivery address is 14 Palm Close, Lekki.", subject: "customer:ada", kind: "fact" });

    const recalled = await call("recall", { query: "What plan is Ada on?", k: 5 });
    const ids = (recalled.data.memories as { id: string }[]).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([pro.data.id, ent.data.id]));
    expect(recalled.data.memories.find((m: { id: string }) => m.id === pro.data.id).conflict).toBe(true);

    const resolved = await call("resolve", { winnerId: ent.data.id, loserId: pro.data.id, action: "supersede", reason: "Confirmed by billing." });
    expect(resolved.text).toMatch(/Recorded as entry #\d+\. #0 is now superseded by #1\./);
    const after = await call("recall", { query: "What plan is Ada on?", k: 5 });
    expect((after.data.memories as { id: string }[]).map((m) => m.id)).not.toContain(pro.data.id);

    const forgotten = await call("forget", { id: address.data.id, reason: "Customer asked to be forgotten" });
    expect(forgotten.data).toMatchObject({ status: "forgotten", target: address.data.id });

    const tl = await call("timeline", { subject: "customer:ada" });
    const entries = tl.data.entries as { id: string; op: string; status: string; text: string | null }[];
    expect(entries.find((e) => e.id === pro.data.id)?.status).toBe("superseded");
    const erased = entries.find((e) => e.id === address.data.id);
    expect(erased?.status).toBe("forgotten");
    expect(erased?.text ?? "").not.toContain("Palm Close");

    const verified = await call("verify", {});
    expect(verified.data).toMatchObject({ status: "valid" });
    expect(verified.data.entries).toBeGreaterThanOrEqual(5);
    expect(verified.text).toMatch(/^Verified: \d+ entries/);
  } finally {
    await client.close();
  }
});
