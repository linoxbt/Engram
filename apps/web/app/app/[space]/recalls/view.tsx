"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { ago, when } from "@/lib/format";
import { PageHeader, useOpenMemory } from "@/components/space-shell";
import { Card, Empty, ErrorNote, Pill, Select, Skeleton, Tabs, cx } from "@/components/ui";

interface Log { id: string; agent: string; agentName: string; query: string; asOf: string | null; k: string; topDistance: string | null; returned: string[]; createdAt: string }
interface Gap { query: string; count: number; best: number; last: string }

export default function RecallsPage() {
  const { space } = useParams<{ space: string }>();
  const open = useOpenMemory();
  const [tab, setTab] = useState<"audit" | "gaps">("audit");
  const [agent, setAgent] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const agents = useQuery({ queryKey: ["space", space, "agents"], queryFn: () => api<{ agents: { id: string; name: string }[] }>(`/api/app/spaces/${space}/agents`) });
  const q = useQuery({ queryKey: ["space", space, "recalls", agent], queryFn: () => api<{ recalls: Log[] }>(`/api/app/spaces/${space}/recalls${agent ? `?agent=${agent}` : ""}`) });
  const gaps = useQuery({ enabled: tab === "gaps", queryKey: ["space", space, "gaps"], queryFn: () => api<{ gaps: Gap[] }>(`/api/app/spaces/${space}/gaps`) });
  return (
    <div className="space-y-4">
      <PageHeader title="Recall audit">Every recall an agent made: what it asked, when, and exactly which memories it received. Logged in the recalls collection with the query vector.</PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "audit", label: "Audit trail" }, { id: "gaps", label: "Knowledge gaps" }]} panelClassName="space-y-4">
        {tab === "audit" && (
          <>
            <Select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)} className="text-xs">
              <option value="">all agents</option>
              {agents.data?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <ErrorNote error={q.error} />
            <Card>
              {q.isLoading && <div className="p-4"><Skeleton className="h-24" /></div>}
              {q.data && !q.data.recalls.length && <Empty title="No recalls yet">When an agent calls recall over MCP or REST, the query and its results are logged here.</Empty>}
              <ul className="divide-y divide-line">
                {q.data?.recalls.map((r) => (
                  <li key={r.id}>
                    <button className="w-full px-4 py-2.5 text-left hover:bg-panel-2" onClick={() => setSel(sel === r.id ? null : r.id)} aria-expanded={sel === r.id}>
                      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted">
                        <span className="text-text">{r.agentName}</span><span>· {ago(r.createdAt)}</span><span>· {r.returned.length} returned</span>
                        <span>· best distance {r.topDistance ?? "—"}</span>
                        {r.asOf && <Pill tone="gold">as of {when(r.asOf)}</Pill>}
                      </div>
                      <p className="mt-0.5 text-sm">{r.query}</p>
                    </button>
                    {sel === r.id && (
                      <div className="flex flex-wrap gap-1.5 bg-bg px-4 pb-3">
                        {r.returned.map((id) => <button key={id} onClick={() => open(id)} className="rounded-[2px] border border-accent/40 px-2 py-0.5 text-2xs text-accent hover:bg-accent/10">#{Number(id.slice(-12))}</button>)}
                        {!r.returned.length && <span className="text-2xs text-muted">Nothing was returned.</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
        {tab === "gaps" && (
          <Card title="Questions memory could not answer well">
            {gaps.isLoading && <div className="p-4"><Skeleton className="h-24" /></div>}
            {gaps.data && !gaps.data.gaps.length && <Empty title="No gaps found">Queries whose best match was far away (cosine distance above 0.45) show up here.</Empty>}
            <ul className="divide-y divide-line">
              {gaps.data?.gaps.map((g) => (
                <li key={g.query} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                  <span>{g.query}</span>
                  <span className="flex shrink-0 items-center gap-3 text-muted"><span className="tabular">{g.count}×</span><span className={cx("tabular", g.best > 0.6 && "text-warn")}>best {g.best.toFixed(2)}</span><span>{ago(g.last)}</span></span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Tabs>
    </div>
  );
}
