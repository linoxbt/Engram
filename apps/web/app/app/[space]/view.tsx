"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Checkpoint } from "@engram/core";
import { api } from "@/lib/client/api";
import { useSpaceInfo, type SpaceInfoResponse } from "@/lib/client/hooks";
import { pollInterval } from "@/lib/client/live";
import { criticalOf, staleBy, warningsOf } from "@/lib/client/report-copy";
import { verifySpaceInBrowser } from "@/lib/client/verify";
import { ChainStrip } from "@/components/chain-strip";
import { Feed, type FeedItem } from "@/components/feed";
import { IconTick } from "@/components/icons";
import { IntegrityBadge, type Integrity } from "@/components/integrity-badge";
import { ReportVerdict } from "@/components/report-status";
import { PageHeader, useCanWrite, useLiveMode, useOpenMemory } from "@/components/space-shell";
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

export function OverviewView() {
  const { space } = useParams<{ space: string }>();
  const live = useLiveMode();
  const open = useOpenMemory();
  const qc = useQueryClient();
  // Stats and the strip refresh slowly; the cheap feed endpoint carries the live updates.
  const canWrite = useCanWrite();
  // Stats and the strip refresh slowly; the cheap feed endpoint carries the live updates. The overview response
  // already carries the first page of the feed, so the feed query starts from it instead of asking again.
  const q = useQuery({
    queryKey: ["space", space, "overview"],
    queryFn: async () => {
      const o = await api<Overview>(`/api/app/spaces/${space}/overview`);
      if (!qc.getQueryData(["space", space, "feed"])) qc.setQueryData(["space", space, "feed"], { items: o.feed });
      return o;
    },
    refetchInterval: live === "polling" ? 15_000 : 60_000,
  });
  const feedQ = useQuery({ enabled: q.isSuccess, queryKey: ["space", space, "feed"], queryFn: () => api<{ items: FeedItem[] }>(`/api/app/spaces/${space}/feed?limit=30`), refetchInterval: pollInterval(live), staleTime: pollInterval(live) });
  // The getting-started checklist is only shown for young spaces; only then are agents and recalls needed here.
  const young = !!q.data && q.data.stats.entries < 40;
  const agents = useQuery({ enabled: young, queryKey: ["space", space, "agents"], queryFn: () => api<{ agents: { lastSeenAt: string | null; status: string }[] }>(`/api/app/spaces/${space}/agents`) });
  const recalls = useQuery({ enabled: young, queryKey: ["space", space, "recalls"], queryFn: () => api<{ recalls: unknown[] }>(`/api/app/spaces/${space}/recalls`) });
  const cps = useQuery({ enabled: q.isSuccess, queryKey: ["space", space, "checkpoints"], queryFn: () => api<{ checkpoints: Checkpoint[] }>(`/api/app/spaces/${space}/checkpoints`), staleTime: 30_000 });
  const verify = useMutation({
    mutationFn: () => api(`/api/app/spaces/${space}/verify`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["space", space] }),
  });
  // The badge's button recomputes every hash, Merkle root and signature here; the server run after it only refreshes the stored badge.
  const info = useSpaceInfo(space);
  const [checked, setChecked] = useState(0);
  const browserVerify = useMutation({
    mutationFn: async () => {
      setChecked(0);
      const d = info.data ?? (await api<SpaceInfoResponse>(`/api/app/spaces/${space}`));
      return verifySpaceInBrowser(space, d.publicKey, (p) => setChecked(p.done), !d.settings.sandbox);
    },
    onSuccess: () => { if (canWrite) verify.mutate(); },
  });
  const browserReport = browserVerify.data;

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
              <IntegrityBadge integrity={o.integrity} checkpoint={o.latestCheckpoint} size="lg" stale={staleBy(o.integrity, o.stats.entries)} onVerify={browserVerify.isPending ? undefined : () => browserVerify.mutate()} />
              {browserVerify.isPending && <p className="mt-2 text-xs text-muted">Recomputing {checked} hashes in your browser…</p>}
              {browserVerify.error ? <div className="mt-2"><ErrorNote error={browserVerify.error} /></div> : null}
              {browserReport && !browserVerify.isPending && (
                <div className="mt-2 space-y-1 text-xs">
                  <ReportVerdict report={browserReport} size={13} />
                  <p className="text-muted">
                    Your browser recomputed {browserReport.entries} entries. {browserReport.checkpointsValid}/{browserReport.checkpointsTotal} signed checkpoints valid.
                    {browserReport.status !== "valid" && (criticalOf(browserReport)[0] ?? warningsOf(browserReport)[0]) ? ` ${(criticalOf(browserReport)[0] ?? warningsOf(browserReport)[0]).message}` : ""} Details on the <Link className="text-accent" href={`/app/${space}/chain`}>Chain</Link> page.
                  </p>
                </div>
              )}
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
                  ) : <div className="text-muted">No signed checkpoint yet. One is made every few minutes and after every {info.data?.settings.checkpointEvery ?? 16} writes.</div>}
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

          <Card title={`Chain · last ${o.strip.length} of ${o.stats.entries}`} action={<Link href={`/app/${space}/chain`} className="text-2xs text-accent hover:underline">Verify →</Link>}>
            <div className="p-4">
              {o.strip.length ? (
                <ChainStrip compact blocks={o.strip.map((b) => ({ ...b, text: o.feed.find((f) => f.seq === b.seq)?.text }))} checkpoints={cps.data ? cps.data.checkpoints.map((c) => Number(c.size)) : o.latestCheckpoint ? [o.latestCheckpoint.size] : []}
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
            <Card title="Top concepts" action={<Link href={`/app/${space}/concepts`} className="text-2xs text-accent hover:underline">Map →</Link>}>
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
          {canWrite && o.stats.entries > 0 && !o.integrity && <Button onClick={() => verify.mutate()} loading={verify.isPending}>Verify on the server</Button>}
        </>
      )}
    </div>
  );
}
