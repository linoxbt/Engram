"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { ago } from "@/lib/format";
import { IconKey, IconPlus, IconSearch } from "@/components/icons";
import { PageHeader } from "@/components/space-shell";
import { Button, Card, CopyButton, Empty, ErrorNote, Field, Input, Modal, Pill, Skeleton, Tabs, Textarea, useToast } from "@/components/ui";

interface Agent { id: string; name: string; description: string; keyPrefix: string; scopes: string[]; status: string; writes: string; recalls: string; lastSeenAt: string | null; createdAt: string; distance?: number | null }
const SCOPES = ["remember", "recall", "forget", "verify", "resolve"] as const;

export default function AgentsPage() {
  const { space } = useParams<{ space: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const info = useSpaceInfo(space);
  const q = useQuery({ queryKey: ["space", space, "agents"], queryFn: () => api<{ agents: Agent[] }>(`/api/app/spaces/${space}/agents`) });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: string; agent: Agent } | null>(null);
  const [revoke, setRevoke] = useState<Agent | null>(null);
  const [find, setFind] = useState("");
  const found = useMutation({ mutationFn: (qs: string) => api<{ agents: Agent[] }>(`/api/app/spaces/${space}/agents/find?q=${encodeURIComponent(qs)}`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/app/spaces/${space}/agents/${id}`, { method: "DELETE" }),
    onSuccess: () => { setRevoke(null); toast("Key revoked. The agent can no longer read or write.", "ok"); qc.invalidateQueries({ queryKey: ["space", space, "agents"] }); },
  });
  const appUrl = info.data?.appUrl ?? (typeof window !== "undefined" ? window.location.origin : "");

  return (
    <div className="space-y-4">
      <PageHeader title="Agents" actions={<Button variant="primary" onClick={() => setCreating(true)}><IconPlus /> New agent</Button>}>
        Each agent has its own key. Every write carries the agent ID, so provenance always says who wrote what. Keys are shown once; only a hash and an 8-character prefix are stored.
      </PageHeader>
      <ErrorNote error={q.error} />
      <Card title="Registry">
        {q.isLoading && <div className="p-4"><Skeleton className="h-24" /></div>}
        {q.data && !q.data.agents.length && <Empty title="No agents yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Create the first key</Button>}>Create a key, then connect Claude Code, the MCP Inspector or any MCP client.</Empty>}
        {q.data && q.data.agents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead><tr className="text-left"><th className="label px-4 py-2">Name</th><th className="label px-2 py-2">Key</th><th className="label px-2 py-2">Scopes</th><th className="label px-2 py-2">Writes</th><th className="label px-2 py-2">Recalls</th><th className="label px-2 py-2">Last seen</th><th className="label px-2 py-2">Status</th><th /></tr></thead>
              <tbody>
                {q.data.agents.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-4 py-2.5"><div>{a.name}</div><div className="max-w-xs text-2xs text-muted">{a.description}</div></td>
                    <td className="px-2 py-2.5"><code>{a.keyPrefix}_…</code></td>
                    <td className="px-2 py-2.5"><div className="flex flex-wrap gap-1">{a.scopes.map((s) => <Pill key={s} tone="accent">{s}</Pill>)}</div></td>
                    <td className="px-2 py-2.5 tabular">{Number(a.writes)}</td>
                    <td className="px-2 py-2.5 tabular">{Number(a.recalls ?? 0)}</td>
                    <td className="px-2 py-2.5 text-muted">{ago(a.lastSeenAt)}</td>
                    <td className="px-2 py-2.5"><Pill tone={a.status === "active" ? "active" : "tampered"}>{a.status}</Pill></td>
                    <td className="px-4 py-2.5 text-right">{a.status === "active" && <Button size="sm" variant="danger" onClick={() => setRevoke(a)}>Revoke</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Find an agent by capability">
        <form className="flex gap-2 p-4" onSubmit={(e) => { e.preventDefault(); if (find.trim()) found.mutate(find.trim()); }}>
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Who handles refunds?" aria-label="Capability" />
          <Button type="submit" loading={found.isPending}><IconSearch /> Search</Button>
        </form>
        {found.data && (
          <ul className="border-t border-line">
            {found.data.agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-b border-line px-4 py-2 text-xs"><span><span className="text-accent">{a.name}</span> <span className="text-muted">· {a.description}</span></span><span className="tabular text-muted">{a.distance != null ? `${Math.round((1 - a.distance) * 100)}% match` : ""}</span></li>
            ))}
          </ul>
        )}
        <p className="px-4 pb-3 text-2xs text-muted">Agent descriptions are embedded with all-minilm (384 dimensions) and searched with cosine similarity in VectorsDB.</p>
      </Card>

      <CreateAgent open={creating} onClose={() => setCreating(false)} space={space} onCreated={(r) => { setCreating(false); setCreated(r); qc.invalidateQueries({ queryKey: ["space", space, "agents"] }); }} />
      <Modal open={!!created} onClose={() => setCreated(null)} title={`Key for ${created?.agent.name ?? ""}`} wide>
        {created && <Snippets apiKey={created.key} url={appUrl} />}
      </Modal>
      <Modal open={!!revoke} onClose={() => setRevoke(null)} title="Revoke key">
        <p className="text-xs text-muted">Revoke the key for <span className="text-text">{revoke?.name}</span>? The agent loses access immediately. Its past entries stay in the chain with its ID.</p>
        <ErrorNote error={del.error} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setRevoke(null)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => revoke && del.mutate(revoke.id)}>Revoke</Button></div>
      </Modal>
    </div>
  );
}

function CreateAgent({ open, onClose, space, onCreated }: { open: boolean; onClose: () => void; space: string; onCreated: (r: { key: string; agent: Agent }) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<string[]>(["remember", "recall", "verify"]);
  const m = useMutation({ mutationFn: () => api<{ key: string; agent: Agent }>(`/api/app/spaces/${space}/agents`, { method: "POST", json: { name, description, scopes } }), onSuccess: (r) => { onCreated(r); setName(""); setDescription(""); } });
  return (
    <Modal open={open} onClose={onClose} title="New agent">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name"><Input required minLength={2} maxLength={48} pattern="[a-zA-Z0-9 ._-]+" value={name} onChange={(e) => setName(e.target.value)} placeholder="support-agent" /></Field>
        <Field label="Description" help="Embedded so agents can be found by capability."><Textarea required minLength={3} maxLength={300} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Customer support agent for billing and refunds." /></Field>
        <Field label="Scopes">
          <div className="flex flex-wrap gap-1.5">
            {SCOPES.map((s) => (
              <button type="button" key={s} aria-pressed={scopes.includes(s)} onClick={() => setScopes((xs) => xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s])}
                className={`h-7 rounded-[2px] border px-2 text-2xs uppercase tracking-wider ${scopes.includes(s) ? "border-accent text-accent" : "border-line-2 text-muted"}`}>{s}</button>
            ))}
          </div>
        </Field>
        <ErrorNote error={m.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={m.isPending} disabled={!scopes.length}><IconKey /> Create key</Button></div>
      </form>
    </Modal>
  );
}

export function Snippets({ apiKey, url }: { apiKey: string; url: string }) {
  const [tab, setTab] = useState<"claude" | "inspector" | "rest" | "sdk">("claude");
  const snippets = {
    claude: `claude mcp add --transport http engram ${url}/api/mcp \\\n  --header "Authorization: Bearer ${apiKey}"`,
    inspector: `npx @modelcontextprotocol/inspector\n# Transport: Streamable HTTP\n# URL: ${url}/api/mcp\n# Header: Authorization: Bearer ${apiKey}`,
    rest: `curl -X POST ${url}/api/v1/memories \\\n  -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" \\\n  -d '{"text":"Ada prefers email over phone calls.","subject":"customer:ada","kind":"preference"}'\n\ncurl -X POST ${url}/api/v1/recall \\\n  -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" \\\n  -d '{"query":"How should we contact Ada?","k":3}'`,
    sdk: `import { Engram } from "engram-sdk";\n\nconst mem = new Engram({ url: "${url}", key: process.env.ENGRAM_KEY! });\nawait mem.remember({ text: "Ada prefers email over phone calls.", subject: "customer:ada", kind: "preference" });\nconst { memories } = await mem.recall({ query: "How should we contact Ada?", k: 3 });`,
  };
  return (
    <div className="space-y-3">
      <div className="rounded-[2px] border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">Copy this key now. It is shown once and only its hash is stored.</div>
      <div className="panel flex items-center gap-2 px-3 py-2"><code className="flex-1 break-all text-xs text-accent">{apiKey}</code><CopyButton value={apiKey} label="Copy key" /></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "claude", label: "Claude Code" }, { id: "inspector", label: "MCP Inspector" }, { id: "rest", label: "REST" }, { id: "sdk", label: "SDK" }]} />
      <div className="relative">
        <pre className="overflow-x-auto rounded-[2px] border border-line bg-bg p-3 text-2xs leading-relaxed"><code>{snippets[tab]}</code></pre>
        <CopyButton value={snippets[tab]} className="absolute right-2 top-2" />
      </div>
    </div>
  );
}
