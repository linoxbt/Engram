"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { pollInterval } from "@/lib/client/live";
import { SUBJECT_PATTERN } from "@/lib/client/patterns";
import { when } from "@/lib/format";
import { Feed, type FeedItem } from "@/components/feed";
import { IconClock, IconCross, IconPlus, IconSearch } from "@/components/icons";
import { MemoryCard, type RecallMemory } from "@/components/memory-card";
import { PageHeader, useCanWrite, useLiveMode, useOpenMemory } from "@/components/space-shell";
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, Pill, Select, Skeleton, Textarea, Toggle, useToast } from "@/components/ui";

const KINDS = ["fact", "preference", "event", "observation", "summary"] as const;
const EXAMPLES = ["What plan is Ada on?", "How should we contact Ada?", "Which customers reported export problems?"];

interface RecallRes { memories: RecallMemory[]; asOf: string | null; conflicts: number; tookMs: number; mode: string }
const PAGE = 60;

export function MemoriesView() {
  const { space } = useParams<{ space: string }>();
  const open = useOpenMemory();
  const live = useLiveMode();
  const qc = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [kinds, setKinds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [agent, setAgent] = useState("");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [asOfDraft, setAsOfDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const canWrite = useCanWrite();

  const subjects = useQuery({ queryKey: ["space", space, "subjects"], queryFn: () => api<{ subjects: { subject: string; count: number }[] }>(`/api/app/spaces/${space}/subjects`) });
  const agents = useQuery({ queryKey: ["space", space, "agents"], queryFn: () => api<{ agents: { id: string; name: string }[] }>(`/api/app/spaces/${space}/agents`) });
  const results = useQuery({
    enabled: !!submitted,
    queryKey: ["space", space, "recall", submitted, includeSuperseded, kinds, subject, agent, asOf],
    queryFn: () => api<RecallRes>(`/api/app/spaces/${space}/recall`, { method: "POST", json: {
      query: submitted, k: 10, includeSuperseded, kinds: kinds.length ? kinds : undefined, subject: subject || undefined, agent: agent || undefined, asOf: asOf ?? undefined,
    } }),
  });
  const browse = useInfiniteQuery({
    enabled: !submitted,
    queryKey: ["space", space, "browse", subject, agent, kinds, includeSuperseded],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (subject) p.set("subject", subject);
      if (agent) p.set("agent", agent);
      if (kinds.length) p.set("kind", kinds.join(","));
      if (!includeSuperseded) p.set("status", "active,recorded");
      if (pageParam) p.set("cursor", pageParam);
      return api<{ items: FeedItem[]; next: string | null }>(`/api/app/spaces/${space}/memories?${p}`);
    },
    getNextPageParam: (last) => (last.items.length >= PAGE && last.next ? last.next : undefined),
    refetchInterval: pollInterval(live),
  });
  const browseItems = browse.data?.pages.flatMap((p) => p.items) ?? [];

  // A one-character question is not searched: say so instead of silently ignoring it.
  const run = (q: string) => {
    setQuery(q);
    const t = q.trim();
    setTooShort(t.length === 1);
    if (t.length === 1) return;
    setSubmitted(t.length >= 2 ? t : null);
  };
  useEffect(() => { if (query.trim().length !== 1) setTooShort(false); }, [query]);
  const maxScore = Math.max(0.01, ...(results.data?.memories.map((m) => m.score) ?? [0]));

  return (
    <div className="space-y-4">
      <PageHeader title="Memory Explorer" actions={canWrite ? <Button onClick={() => setAdding(true)}><IconPlus /> Add memory</Button> : undefined}>
        Search runs the same recall agents use: vector search with filters, re-ranked by similarity, recency, importance and use, then diversified.
      </PageHeader>

      <form onSubmit={(e) => { e.preventDefault(); run(query); }} className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input aria-label="Search memories" aria-describedby={tooShort ? "query-hint" : undefined} aria-invalid={tooShort || undefined} maxLength={500} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask a question, e.g. What plan is Ada on?" className="h-10 pl-9 text-sm" />
        </div>
        <Button type="submit" variant="primary" className="h-10">Recall</Button>
        {submitted && <Button type="button" variant="ghost" className="h-10" onClick={() => { setSubmitted(null); setQuery(""); }}>Clear</Button>}
      </form>
      {tooShort && <p id="query-hint" role="status" className="-mt-2 text-2xs text-warn">Type at least 2 characters to search.</p>}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2"><Toggle checked={includeSuperseded} onChange={setIncludeSuperseded} label="Include superseded" /> include superseded</label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Kinds">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKinds((ks) => ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])} aria-pressed={kinds.includes(k)}
              className={`h-7 rounded-[2px] border px-2 text-2xs uppercase tracking-wider ${kinds.includes(k) ? "border-accent text-accent" : "border-line-2 text-muted hover:text-text"}`}>{k}</button>
          ))}
        </div>
        <Select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-7 text-xs">
          <option value="">all subjects</option>
          {subjects.data?.subjects.map((s) => <option key={s.subject} value={s.subject}>{s.subject} ({s.count})</option>)}
        </Select>
        <Select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)} className="h-7 text-xs">
          <option value="">all agents</option>
          {agents.data?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        {asOf ? (
          <span className="inline-flex items-center gap-1"><Pill tone="gold"><IconClock size={11} /> as of {when(asOf)}</Pill><button aria-label="Clear as-of" onClick={() => setAsOf(null)} className="text-muted hover:text-text"><IconCross size={12} /></button></span>
        ) : (
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (asOfDraft) setAsOf(new Date(asOfDraft + "Z").toISOString()); }}>
            <Input type="datetime-local" aria-label="As of (UTC)" value={asOfDraft} onChange={(e) => setAsOfDraft(e.target.value)} className="h-7 w-auto text-xs" />
            <Button size="sm" type="submit" variant="ghost"><IconClock /> as of</Button>
          </form>
        )}
      </div>

      {asOf && submitted && <div className="rounded-[2px] border border-gold/40 bg-gold/5 px-3 py-2 text-xs text-gold">Showing what was known on {when(asOf)} UTC.</div>}

      {submitted ? (
        <section aria-live="polite" className="space-y-2">
          {results.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
          <ErrorNote error={results.error} />
          {results.data && (
            <>
              <p className="text-2xs text-muted">{results.data.memories.length} results · {results.data.conflicts} in conflict · {results.data.tookMs} ms</p>
              {results.data.memories.map((m) => <MemoryCard key={m.id} m={m} onOpen={open} asOf={asOf} maxScore={maxScore} />)}
              {!results.data.memories.length && <Card><Empty title="No memories match">Try different words, include superseded memories, or clear the filters.</Empty></Card>}
            </>
          )}
        </section>
      ) : (
        <Card title="Newest entries">
          {browse.isLoading && <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
          <ErrorNote error={browse.error} />
          {browseItems.length > 0 && <Feed items={browseItems} onOpen={open} />}
          {browse.hasNextPage && (
            <div className="flex justify-center border-t border-line p-3">
              <Button size="sm" variant="outline" loading={browse.isFetchingNextPage} onClick={() => void browse.fetchNextPage()}>Load more</Button>
            </div>
          )}
          {browse.data && !browseItems.length && (
            <Empty title="Nothing here yet" action={<div className="flex flex-wrap justify-center gap-2">{EXAMPLES.map((e) => <Button key={e} size="sm" variant="ghost" onClick={() => run(e)}>{e}</Button>)}</div>}>
              Try one of these questions{canWrite ? ", or add a memory" : ""}.
            </Empty>
          )}
        </Card>
      )}

      {canWrite && <AddMemory open={adding} onClose={() => setAdding(false)} space={space} onDone={(msg) => { toast(msg, "ok"); qc.invalidateQueries({ queryKey: ["space", space] }); }} />}
    </div>
  );
}

function AddMemory({ open, onClose, space, onDone }: { open: boolean; onClose: () => void; space: string; onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState("fact");
  const [importance, setImportance] = useState(5);
  // Each opening starts clean: no leftover error or half-typed fields from last time.
  useEffect(() => { if (open) { setText(""); setSubject(""); setKind("fact"); setImportance(5); m.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api<{ seq: number; status: string; relations: { relation: string; seq: number }[] }>(`/api/app/spaces/${space}/memories`, { method: "POST", json: { text, kind, importance, subject: subject || undefined } }),
    onSuccess: (r) => {
      onClose(); setText("");
      const rel = r.relations.filter((x) => x.relation !== "unrelated").map((x) => `${x.relation} #${x.seq}`).join(", ");
      onDone(r.status === "duplicate" ? `Already known. Linked to #${r.seq}.` : `Saved as #${r.seq}.${rel ? ` ${rel}.` : ""}`);
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Add memory">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Memory" help="One clear, self-contained sentence. Engram checks it against close neighbours."><Textarea required minLength={3} maxLength={2000} rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject" help='Like "customer:ada"'><Input value={subject} onChange={(e) => setSubject(e.target.value.toLowerCase())} pattern={SUBJECT_PATTERN} title="kind:name, lowercase, like customer:ada" placeholder="customer:ada" /></Field>
          <Field label="Kind"><Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full">{KINDS.slice(0, 4).map((k) => <option key={k}>{k}</option>)}</Select></Field>
        </div>
        <Field label={`Importance: ${importance}`}><input type="range" min={0} max={10} value={importance} onChange={(e) => setImportance(Number(e.target.value))} className="w-full accent-[#0a0a0a]" /></Field>
        <ErrorNote error={m.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={m.isPending}>Remember</Button></div>
      </form>
    </Modal>
  );
}
