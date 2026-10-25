"use client";
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RelationChips, type FeedItem } from "@/components/feed";
import { OpIcon } from "@/components/icons";
import { Card, Empty, PageHeader, Skeleton } from "@/components/ui";
import { NoSpaces, SpaceTag, StorageNotice } from "@/components/workspace-ui";
import { ago } from "@/lib/format";
import { storageDown, useEachSpace, useHealth, useSpaces } from "@/lib/client/workspace";

const OPS = [{ id: "all", label: "All" }, { id: "remember", label: "Memories" }, { id: "forget", label: "Forgets" }, { id: "link", label: "Resolutions" }, { id: "reflect", label: "Summaries" }] as const;

export function View() {
  const spaces = useSpaces();
  const health = useHealth();
  const ready = !!health.data && !storageDown(health.data);
  const feeds = useEachSpace<{ items: FeedItem[] }>(spaces.data?.spaces, "feed-workspace", (k) => `/api/app/spaces/${k}/feed?limit=25`, ready, 15_000);
  const failed = feeds.rows.filter((r) => r.error && !r.data);
  const [space, setSpace] = useState("all");
  const [op, setOp] = useState<(typeof OPS)[number]["id"]>("all");
  const items = useMemo(() => feeds.rows
    .flatMap((r) => (r.data?.items ?? []).map((it) => ({ ...it, space: r.space })))
    .filter((it) => (space === "all" || it.space.key === space) && (op === "all" || it.op === op))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 80), [feeds.rows, space, op]);
  const list = spaces.data?.spaces ?? [];

  return (
    <>
      <PageHeader title="Activity">Every write across your spaces, newest first: memories, supersessions, resolutions and erasures, each an entry on its space&apos;s hash chain.</PageHeader>
      <StorageNotice health={health.data} />
      {spaces.data && !list.length ? <NoSpaces /> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {OPS.map((o) => (
                <button key={o.id} onClick={() => setOp(o.id)} className={clsx("h-7 rounded-[2px] border px-2.5 text-2xs uppercase tracking-wider", op === o.id ? "border-accent bg-accent text-bg" : "border-line-2 text-muted hover:text-text")}>{o.label}</button>
              ))}
            </div>
            <select value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Filter by space" className="h-7 rounded-[2px] border border-line-2 bg-bg px-2 text-xs sm:ml-auto">
              <option value="all">All spaces</option>
              {list.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
          {failed.length > 0 && (
            <div role="alert" className="mb-3 space-y-1 rounded-[2px] border border-warn/50 bg-warn/5 px-4 py-2.5 text-xs">
              {failed.map((r) => <div key={r.space.key}><span className="text-warn">Could not load activity from {r.space.name}:</span> <span className="text-muted">{r.error instanceof Error ? r.error.message : String(r.error)}</span></div>)}
            </div>
          )}
          <Card>
            {(spaces.isLoading || (ready && feeds.loading)) && <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
            {!feeds.loading && ready && !items.length && failed.length < feeds.rows.length && <Empty title="Nothing here yet">Writes from your agents appear here the moment they land on the chain.</Empty>}
            {!ready && health.data && <Empty title="Waiting for memory storage">Activity appears once the memory database is provisioned.</Empty>}
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="relative flex gap-3 px-4 py-3 hover:bg-panel-2">
                  <span className={clsx("mt-0.5", it.op === "forget" ? "text-muted" : it.op === "link" ? "text-gold" : "text-text")}><OpIcon op={it.op} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted">
                      <span className="tabular text-text">#{it.seq}</span>
                      <span>{it.agentName}</span>
                      <span>· {ago(it.createdAt)}</span>
                      {it.subject && <span className="truncate">· {it.subject}</span>}
                      {/* A sibling link above the row's own link, never nested inside it. */}
                      <span className="relative z-10"><SpaceTag spaceKey={it.space.key} name={it.space.name} /></span>
                    </span>
                    {/* The row's one primary link; its ::after stretches over the whole row. */}
                    <Link href={`/app/${it.space.key}/memories/${it.id}`} className={clsx("mt-1 block text-xs after:absolute after:inset-0 after:content-['']", it.text == null && "italic text-muted")}>{it.text ?? "Content erased. The entry stays on the chain."}</Link>
                    {(it.supersedes.length > 0 || it.contradicts.length > 0 || it.related.length > 0 || it.target != null) && <span className="mt-1.5 block"><RelationChips item={it} /></span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
