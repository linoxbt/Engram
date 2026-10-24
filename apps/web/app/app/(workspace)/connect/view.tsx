"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { IconArrow, IconKey } from "@/components/icons";
import { Card, CopyButton, PageHeader, Tabs } from "@/components/ui";
import { useSpaces } from "@/lib/client/workspace";

const KEY = "<YOUR_AGENT_KEY>";
const TOOLS = [
  ["remember", "Store a memory. Engram embeds it, finds its neighbours and records supersessions or conflicts."],
  ["recall", "Search by meaning, optionally as of a past moment. Every recall is logged for audit."],
  ["forget", "Erase content for good. The erasure itself stays on the chain as proof."],
  ["timeline", "Everything known about a subject, in order, including what changed and when."],
  ["verify", "Check the chain and return the latest signed checkpoint."],
  ["resolve", "Settle a conflict between two memories with a recorded decision."],
] as const;

type Tab = "claude" | "cursor" | "rest" | "sdk";

export function View() {
  const spaces = useSpaces();
  const [origin, setOrigin] = useState("https://your-engram.example");
  const [tab, setTab] = useState<Tab>("claude");
  const [space, setSpace] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const list = spaces.data?.spaces ?? [];
  const target = space || list[0]?.key || "";

  const snippets: Record<Tab, string> = {
    claude: `claude mcp add --transport http engram ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${KEY}"`,
    cursor: JSON.stringify({ mcpServers: { engram: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${KEY}` } } } }, null, 2),
    rest: `curl -X POST ${origin}/api/v1/memories \\\n  -H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json" \\\n  -d '{"text":"Ada prefers email over phone calls.","subject":"customer:ada","kind":"preference"}'`,
    sdk: `import { Engram } from "engram-sdk";\n\nconst mem = new Engram({ url: "${origin}", key: process.env.ENGRAM_KEY! });\nawait mem.remember({ text: "Ada prefers email over phone calls.", subject: "customer:ada" });\nconst { memories } = await mem.recall({ query: "How should we contact Ada?", k: 3 });`,
  };

  return (
    <>
      <PageHeader title="Connect an agent">Give any MCP client a memory it can prove. One key per agent, one line of config.</PageHeader>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card title="1 · Create an agent key">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
              <label className="flex-1 text-xs">
                <span className="label mb-1 block">Space</span>
                <select value={target} onChange={(e) => setSpace(e.target.value)} disabled={!list.length} className="h-9 w-full rounded-[2px] border border-line-2 bg-bg px-2 text-xs">
                  {!list.length && <option value="">Create a space first</option>}
                  {list.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
              </label>
              {target
                ? <Link href={`/app/${target}/agents`} className="inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-accent px-4 text-xs text-bg"><IconKey /> Create key in this space</Link>
                : <Link href="/app" className="inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-accent px-4 text-xs text-bg">Create a space <IconArrow /></Link>}
            </div>
            <p className="border-t border-line px-4 py-3 text-2xs text-muted">Keys are scoped (remember, recall, forget, verify) and shown once. Engram stores only a hash.</p>
          </Card>
          <Card title="2 · Add it to your client">
            <div className="space-y-3 p-4">
              <Tabs value={tab} onChange={setTab} tabs={[{ id: "claude", label: "Claude Code" }, { id: "cursor", label: "Cursor / mcp.json" }, { id: "rest", label: "REST" }, { id: "sdk", label: "SDK" }]} />
              <div className="relative">
                <pre className="overflow-x-auto rounded-[2px] border border-line bg-panel p-3 pr-16 text-2xs leading-relaxed"><code>{snippets[tab]}</code></pre>
                <CopyButton value={snippets[tab]} className="absolute right-2 top-2" />
              </div>
              <p className="text-2xs text-muted">Replace <code className="text-text">{KEY}</code> with the key from step 1. The MCP endpoint is <code className="text-text">{origin}/api/mcp</code> (Streamable HTTP).</p>
            </div>
          </Card>
          <Card title="3 · Watch it land">
            <p className="p-4 text-xs text-muted">Ask your agent to remember something. The write appears in <Link href="/app/feed" className="text-text underline underline-offset-2">Activity</Link> within seconds, chained and, at the next checkpoint, signed. Contradictions show up in the <Link href="/app/inbox" className="text-text underline underline-offset-2">Inbox</Link>.</p>
          </Card>
        </div>
        <Card title="Tools your agent gets">
          <ul className="divide-y divide-line">
            {TOOLS.map(([name, text]) => (
              <li key={name} className="px-4 py-3"><code className="text-xs">{name}()</code><p className="mt-1 text-2xs text-muted">{text}</p></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
