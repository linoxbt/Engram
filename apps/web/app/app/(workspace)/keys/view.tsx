"use client";
import Link from "next/link";
import { useMemo } from "react";
import { IconKey, IconPlug } from "@/components/icons";
import { Card, Empty, PageHeader, Pill, Skeleton, Stat } from "@/components/ui";
import { NoSpaces, SpaceTag, StorageNotice } from "@/components/workspace-ui";
import { ago } from "@/lib/format";
import { storageDown, useEachSpace, useHealth, useSpaces } from "@/lib/client/workspace";

interface Agent { id: string; name: string; description: string; keyPrefix: string; scopes: string[]; status: string; writes: string; recalls: string; lastSeenAt: string | null; createdAt: string }

export function View() {
  const spaces = useSpaces();
  const health = useHealth();
  const ready = !!health.data && !storageDown(health.data);
  const agents = useEachSpace<{ agents: Agent[] }>(spaces.data?.spaces, "agents", (k) => `/api/app/spaces/${k}/agents`, ready);
  const rows = useMemo(() => agents.rows
    .flatMap((r) => (r.data?.agents ?? []).map((a) => ({ ...a, space: r.space })))
    .sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")), [agents.rows]);
  const active = rows.filter((a) => a.status === "active");
  const writes = rows.reduce((n, a) => n + Number(a.writes || 0), 0);
  const recalls = rows.reduce((n, a) => n + Number(a.recalls || 0), 0);

  return (
    <>
      <PageHeader title="Agent keys" actions={<Link href="/app/connect" className="inline-flex h-8 items-center gap-2 rounded-[2px] bg-accent px-3 text-xs text-bg"><IconPlug /> Connect an agent</Link>}>
        Every agent identity across your spaces. Keys are shown once at creation and only their hash is stored; every write an agent makes is attributed to it on the chain.
      </PageHeader>
      <StorageNotice health={health.data} />
      {spaces.data && !spaces.data.spaces.length ? <NoSpaces /> : (
        <>
          {ready && (
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Agents" value={rows.length} />
              <Stat label="Active" value={active.length} tone="valid" />
              <Stat label="Writes" value={writes} />
              <Stat label="Recalls" value={recalls} />
            </div>
          )}
          <Card>
            {(spaces.isLoading || (ready && agents.loading)) && <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
            {ready && !agents.loading && !rows.length && <Empty title="No agents yet" action={<Link href="/app/connect" className="text-xs underline underline-offset-2">Connect your first agent</Link>}>Create a key inside a space, then add it to Claude Code, Cursor or any MCP client.</Empty>}
            {!ready && health.data && <Empty title="Waiting for memory storage">Agent keys are stored with each space and appear once the memory database is provisioned.</Empty>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead><tr className="border-b border-line text-left"><th className="label px-4 py-2 font-normal">Agent</th><th className="label px-2 py-2 font-normal">Space</th><th className="label px-2 py-2 font-normal">Scopes</th><th className="label px-2 py-2 font-normal">Usage</th><th className="label px-2 py-2 font-normal">Last seen</th><th className="px-4 py-2" /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((a) => (
                      <tr key={`${a.space.key}-${a.id}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2"><IconKey size={12} /> {a.name} {a.status !== "active" && <Pill tone="forgotten">{a.status}</Pill>}</div>
                          <code className="text-2xs text-muted">{a.keyPrefix}_••••</code>
                        </td>
                        <td className="px-2 py-3"><SpaceTag spaceKey={a.space.key} name={a.space.name} /></td>
                        <td className="px-2 py-3"><div className="flex flex-wrap gap-1">{a.scopes.map((s) => <Pill key={s} tone="accent">{s}</Pill>)}</div></td>
                        <td className="px-2 py-3 tabular text-muted">{Number(a.writes || 0)} writes · {Number(a.recalls || 0)} recalls</td>
                        <td className="px-2 py-3 text-muted">{ago(a.lastSeenAt)}</td>
                        <td className="px-4 py-3 text-right"><Link href={`/app/${a.space.key}/agents`} className="text-2xs hover:underline">Manage</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
