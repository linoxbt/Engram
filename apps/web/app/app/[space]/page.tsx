"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { pollInterval } from "@/lib/client/live";
import { ChainStrip } from "@/components/chain-strip";
import { Feed, type FeedItem } from "@/components/feed";
import { IconTick } from "@/components/icons";
import { IntegrityBadge, type Integrity } from "@/components/integrity-badge";
import { PageHeader, useLiveMode, useOpenMemory } from "@/components/space-shell";
import { Button, Card, Empty, ErrorNote, Skeleton, Stat, cx } from "@/components/ui";

interface Overview {
  space: { key: string; name: string; sandbox: boolean; publicVerify: boolean };
  integrity: Integrity | null;
  latestCheckpoint: { fileId: string; seq: number; size: number; createdAt: string } | null;
  stats: { entries: number; memories: number; active: number; superseded: number; forgotten: number; conflicts: number; agents: number; concepts: number; forgets: number; links: number };
  feed: FeedItem[];
  strip: { seq: number; op: string; status: string; hash: string }[];
  topConcepts: { id: string; label: string; members: number }[];
}

export default function OverviewPage() {
  const { space } = useParams<{ space: string }>();
  const live = useLiveMode();
  const open = useOpenMemory();
  const qc = useQueryClient();
  // Stats and the strip refresh slowly; the cheap feed endpoint carries the live updates.
  const q = useQuery({ queryKey: ["space", space, "overview"], queryFn: () => api<Overview>(`/api/app/spaces/${space}/overview`), refetchInterval: live === "polling" ? 15_000 : false });
  const feedQ = useQuery({ queryKey: ["space", space, "feed"], queryFn: () => api<{ items: FeedItem[] }>(`/api/app/spaces/${space}/feed?limit=30`), refetchInterval: pollInterval(live) });
  const agents = useQuery({ queryKey: ["space", space, "agents"], queryFn: () => api<{ agents: { lastSeenAt: string | null; status: string }[] }>(`/api/app/spaces/${space}/agents`) });
  const recalls = useQuery({ queryKey: ["space", space, "recalls"], queryFn: () => api<{ recalls: unknown[] }>(`/api/app/spaces/${space}/recalls`) });
  const verify = useMutation({
    mutationFn: () => api(`/api/app/spaces/${space}/verify`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["space", space] }),
  });

  // New entries slide in.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const feedItems = feedQ.data?.items ?? q.data?.feed ?? [];
  useEffect(() => {
    if (!feedItems.length) return;
    const ids = feedItems.map((f) => f.id);
    if (seen.current) setFresh(new Set(ids.filter((id) => !seen.current!.has(id))));
    seen.current = new Set(ids);
  }, [feedItems]);

  const o = q.data;
  const checklist = o && [
    { done: (agents.data?.agents.length ?? 0) > 0, label: "Create an agent key", href: `/app/${space}/agents` },
    { done: (agents.data?.agents ?? []).some((a) => a.lastSeenAt), label: "Connect an MCP client", href: `/docs/mcp` },
    { done: o.stats.memories > 0, label: "Write a first memory", href: `/app/${space}/memories` },
    { done: (recalls.data?.recalls.length ?? 0) > 0, label: "Recall it from an agent", href: `/docs/mcp` },
    { done: !!o.integrity, label: "Run verification", href: `/app/${space}/chain` },
  ];
  const showChecklist = checklist && checklist.some((c) => !c.done) && o.stats.entries < 40;

  return (
    <div className="space-y-5">
      <PageHeader title="Overview">Every entry is stored by meaning, chained by hash and replayable in time.</PageHeader>
      <ErrorNote error={q.error} />
      {!o && q.isLoading && <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28 md:col-span-2" /><Skeleton className="h-28" /><Skeleton className="h-64 md:col-span-3" /></div>}
      {o && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <IntegrityBadge integrity={o.integrity} checkpoint={o.latestCheckpoint} size="lg" onVerify={() => verify.mutate()} />
              {verify.isPending && <p className="mt-2 text-xs text-muted">Verifying on the server… for a trust-nobody check, open the <Link className="text-cyan" href={`/app/${space}/chain`}>Chain</Link> page.</p>}
            </div>
            {showChecklist ? (
              <Card title="Get started" className="p-0">
                <ul className="p-3">
                  {checklist!.map((c) => (
                    <li key={c.label}>
                      <Link href={c.href} className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-xs hover:bg-panel-2">
                        <span className={cx("inline-flex size-4 items-center justify-center rounded-[2px] border", c.done ? "border-valid bg-valid/20 text-valid" : "border-line-2")}>{c.done && <IconTick size={10} />}</span>
                        <span className={cx(c.done && "text-muted line-through")}>{c.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <Card title="Latest checkpoint" state={o.latestCheckpoint ? "sealed" : undefined}>
                <div className="p-4 text-xs">
                  {o.latestCheckpoint ? (
                    <>
                      <div className="text-gold">{o.latestCheckpoint.fileId}</div>
                      <div className="mt-1 text-muted">{o.latestCheckpoint.size} entries signed with Ed25519.</div>
                    </>
                  ) : <div className="text-muted">No signed checkpoint yet. One is made every few minutes and after every {"N"} writes.</div>}
                </div>
              </Card>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Memories" value={o.stats.memories} />
            <Stat label="Active" value={o.stats.active} tone="valid" />
            <Stat label="Superseded" value={o.stats.superseded} tone="muted" />
            <Stat label="Forgotten" value={o.stats.forgotten} tone="muted" />
            <Stat label="Open conflicts" value={o.stats.conflicts} tone={o.stats.conflicts ? "tamper" : undefined} />
            <Stat label="Agents" value={o.stats.agents} />
          </div>

          <Card title={`Chain · last ${o.strip.length} of ${o.stats.entries}`} action={<Link href={`/app/${space}/chain`} className="text-2xs text-cyan hover:underline">Verify →</Link>}>
            <div className="p-4">
              {o.strip.length ? (
                <ChainStrip compact blocks={o.strip.map((b) => ({ ...b, text: o.feed.find((f) => f.seq === b.seq)?.text }))} checkpoints={o.latestCheckpoint ? [o.latestCheckpoint.size] : []}
                  onOpen={(seq) => open(`m_${space}_${String(seq).padStart(12, "0")}`)} label="Recent chain entries" />
              ) : <p className="text-xs text-muted">The chain is empty. The first memory becomes entry #0, linked to the space's genesis hash.</p>}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Live feed" className="lg:col-span-2" action={<span className="text-2xs text-muted">{live === "realtime" ? "realtime" : "updates every 3s"}</span>}>
              {feedItems.length ? <Feed items={feedItems} onOpen={open} fresh={fresh} /> : (
                <Empty title="Waiting for the first memory">Connect an agent over MCP and ask it to remember something. It will appear here the moment it is written.</Empty>
              )}
            </Card>
            <Card title="Top concepts" action={<Link href={`/app/${space}/concepts`} className="text-2xs text-cyan hover:underline">Map →</Link>}>
              <ul className="p-2">
                {o.topConcepts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-2 py-1.5 text-xs">
                    <span className="truncate text-violet">{c.label}</span>
                    <span className="tabular text-muted">{c.members}</span>
                  </li>
                ))}
                {!o.topConcepts.length && <li className="px-2 py-6 text-center text-xs text-muted">Concepts form as memories arrive.</li>}
              </ul>
              <div className="border-t border-line px-4 py-2.5 text-2xs text-muted">{o.stats.forgets} forget entries · {o.stats.links} resolutions · {o.stats.concepts} concepts</div>
            </Card>
          </div>
          {o.stats.entries > 0 && !o.integrity && <Button onClick={() => verify.mutate()} loading={verify.isPending}>Verify on the server</Button>}
        </>
      )}
    </div>
  );
}
