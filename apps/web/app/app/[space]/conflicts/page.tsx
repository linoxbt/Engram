"use client";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { when } from "@/lib/format";
import { PageHeader, useOpenMemory } from "@/components/space-shell";
import { Button, Card, Empty, ErrorNote, Pill, Skeleton, useToast } from "@/components/ui";

interface Side { id: string; seq: number; text: string | null; agentName: string; createdAt: string; source: string | null; subject: string | null; importance: number }
interface Pair { a: Side; b: Side; reason: string }

export default function ConflictsPage() {
  const { space } = useParams<{ space: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const open = useOpenMemory();
  const q = useQuery({ queryKey: ["space", space, "conflicts"], queryFn: () => api<{ pairs: Pair[] }>(`/api/app/spaces/${space}/conflicts`) });
  // Pending decisions per conflict pair, so overlapping mutations neither clear each other nor double-submit.
  const [pending, setPending] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const resolve = useMutation({
    mutationFn: (v: { pair: string; winnerId: string; loserId: string; action: "supersede" | "refine" | "dismiss" }) => api<{ seq: number }>(`/api/app/spaces/${space}/conflicts`, { method: "POST", json: { winnerId: v.winnerId, loserId: v.loserId, action: v.action, reason: v.action === "supersede" ? "Resolved in the conflict inbox" : v.action === "refine" ? "Both true" : "Not a real conflict" } }),
    onMutate: (v) => setPending((m) => ({ ...m, [v.pair]: v.action + v.winnerId })),
    onSuccess: (r) => { toast(`Recorded as entry #${r.seq}.`, "ok"); return qc.invalidateQueries({ queryKey: ["space", space] }); },
    onSettled: (_r, _e, v) => { inFlight.current.delete(v.pair); setPending((m) => { const n = { ...m }; delete n[v.pair]; return n; }); },
  });
  const decide = (pair: string, action: "supersede" | "refine" | "dismiss", winnerId: string, loserId: string) => {
    if (inFlight.current.has(pair)) return;
    inFlight.current.add(pair);
    resolve.mutate({ pair, winnerId, loserId, action });
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Conflict inbox">Two memories disagree and nothing shows which is right. Every decision appends a link entry, so the history shows when and by whom a conflict was settled.</PageHeader>
      <ErrorNote error={q.error || resolve.error} />
      {q.isLoading && <Skeleton className="h-40" />}
      {q.data && !q.data.pairs.length && <Card><Empty title="No open conflicts">When an agent writes a fact that disagrees with an active memory, the pair lands here.</Empty></Card>}
      {q.data?.pairs.map((p) => {
        const key = p.a.id + p.b.id;
        return (
          <Card key={key} state="tampered" title={<span>#{p.a.seq} and #{p.b.seq} disagree. Choose which is right.</span>}>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {[p.a, p.b].map((s, i) => (
                <div key={s.id} className="panel flex flex-col p-3">
                  <div className="flex items-center justify-between text-2xs text-muted"><span>{i === 0 ? "A" : "B"} · #{s.seq}</span><button className="text-accent hover:underline" onClick={() => open(s.id)}>details</button></div>
                  <p className="mt-2 flex-1 text-sm">{s.text}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-2xs text-muted">
                    <span>{s.agentName}</span><span>· {when(s.createdAt)}</span>{s.source && <Pill tone="accent">{s.source}</Pill>}<span>· importance {s.importance}</span>
                  </div>
                  <Button className="mt-3" variant="outline" loading={pending[key] === "supersede" + s.id} disabled={!!pending[key]}
                    onClick={() => decide(key, "supersede", s.id, i === 0 ? p.b.id : p.a.id)}>
                    {i === 0 ? "A" : "B"} is right
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
              <p className="text-2xs text-muted">{p.reason}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" loading={pending[key] === "refine" + p.b.id} disabled={!!pending[key]} onClick={() => decide(key, "refine", p.b.id, p.a.id)}>Both true</Button>
                <Button size="sm" variant="ghost" loading={pending[key] === "dismiss" + p.b.id} disabled={!!pending[key]} onClick={() => decide(key, "dismiss", p.b.id, p.a.id)}>Dismiss</Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
