"use client";
import Link from "next/link";
import { IconArrow, IconInbox } from "@/components/icons";
import { Card, Empty, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { NoSpaces, StorageNotice } from "@/components/workspace-ui";
import { ago, plural } from "@/lib/format";
import { storageDown, useEachSpace, useHealth, useSpaces } from "@/lib/client/workspace";

interface Side { id: string; seq: number; text: string | null; agentName: string; createdAt: string; source: string | null; subject: string | null }
interface Pair { a: Side; b: Side; reason: string }

function SideCard({ s }: { s: Side }) {
  return (
    <div className="min-w-0 flex-1 rounded-[2px] border border-line bg-bg px-3 py-2.5">
      <div className="flex flex-wrap gap-x-2 text-2xs text-muted"><span className="tabular text-text">#{s.seq}</span><span>{s.agentName}</span><span>· {ago(s.createdAt)}</span>{s.source && <span>· {s.source}</span>}</div>
      <p className="mt-1 text-xs">{s.text ?? <span className="italic text-muted">erased</span>}</p>
    </div>
  );
}

export function View() {
  const spaces = useSpaces();
  const health = useHealth();
  const ready = !!health.data && !storageDown(health.data);
  const conflicts = useEachSpace<{ pairs: Pair[] }>(spaces.data?.spaces, "conflicts", (k) => `/api/app/spaces/${k}/conflicts`, ready);
  const withPairs = conflicts.rows.filter((r) => r.data?.pairs.length);
  const total = withPairs.reduce((n, r) => n + (r.data?.pairs.length ?? 0), 0);

  return (
    <>
      <PageHeader title="Inbox">Contradictions your agents wrote, across every space. Nothing is overwritten: resolving one records a decision on the chain, and the losing memory is superseded, not deleted.</PageHeader>
      <StorageNotice health={health.data} />
      {spaces.data && !spaces.data.spaces.length ? <NoSpaces /> : (
        <>
          {(spaces.isLoading || (ready && conflicts.loading)) && <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
          {ready && !conflicts.loading && !total && (
            <Card><Empty title="Inbox zero">No open conflicts in any space. When two memories disagree, the pair lands here for a human decision.</Empty></Card>
          )}
          {ready && total > 0 && <p className="mb-3 text-xs text-muted">{plural(total, "open conflict")} in {plural(withPairs.length, "space")}.</p>}
          <div className="space-y-5">
            {conflicts.rows.map((r) => (r.error ? (
              <div key={r.space.key}><div className="label mb-1">{r.space.name}</div><ErrorNote error={r.error} /></div>
            ) : r.data?.pairs.length ? (
              <Card key={r.space.key} title={<span className="flex items-center gap-2"><IconInbox size={12} /> {r.space.name} · {r.data.pairs.length}</span>}
                action={<Link href={`/app/${r.space.key}/conflicts`} className="flex items-center gap-1 text-2xs text-text hover:underline">Resolve <IconArrow size={11} /></Link>}>
                <ul className="divide-y divide-line">
                  {r.data.pairs.map((p) => (
                    <li key={`${p.a.id}-${p.b.id}`} className="p-4">
                      <div className="flex flex-col gap-2 md:flex-row"><SideCard s={p.a} /><SideCard s={p.b} /></div>
                      {p.reason && <p className="mt-2 text-2xs text-tamper">{p.reason}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null))}
          </div>
        </>
      )}
    </>
  );
}
