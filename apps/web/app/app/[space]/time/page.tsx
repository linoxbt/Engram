"use client";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { day, when } from "@/lib/format";
import { IconClock, IconSeal } from "@/components/icons";
import type { RecallMemory } from "@/components/memory-card";
import { PageHeader, useOpenMemory } from "@/components/space-shell";
import { Button, Card, Empty, ErrorNote, Input, Pill, Skeleton, cx } from "@/components/ui";

interface Ticks { subjects: { subject: string; count: number }[]; span: { first: string; last: string } | null; ticks: { seq: number; op: string; at: string; superseding: boolean; subject: string | null }[] }
interface RecallRes { memories: RecallMemory[]; asOf: string | null; mode: string; replayed?: number; checkpoint: { fileId: string; size: number; createdAt: string } | null; tookMs: number }

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function TimeMachinePage() {
  const { space } = useParams<{ space: string }>();
  const open = useOpenMemory();
  const t = useQuery({ queryKey: ["space", space, "subjects"], queryFn: () => api<Ticks>(`/api/app/spaces/${space}/subjects`) });
  const hasAda = t.data?.subjects.some((s) => s.subject === "customer:ada");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  useEffect(() => { if (hasAda && !submitted) { setQuery("What plan is Ada on?"); setSubmitted("What plan is Ada on?"); } }, [hasAda, submitted]);

  const start = t.data?.span ? Date.parse(t.data.span.first) - 3_600_000 : Date.now() - 86_400_000;
  const end = Date.now();
  const [pos, setPos] = useState<number | null>(null);
  useEffect(() => {
    if (pos == null && t.data?.span) {
      // Start on Tuesday 20 October midday when the demo story is loaded, else halfway.
      const tue = Date.parse("2026-10-20T12:00:00.000Z");
      setPos(hasAda && tue > start && tue < end ? tue : start + (end - start) / 2);
    }
  }, [t.data, pos, start, end, hasAda]);
  const asOf = pos == null ? null : new Date(Math.round(pos)).toISOString();
  const debounced = useDebounced(asOf, 150);

  const then = useQuery({
    enabled: !!submitted && !!debounced, placeholderData: (p) => p,
    queryKey: ["space", space, "tm", submitted, debounced],
    queryFn: () => api<RecallRes>(`/api/app/spaces/${space}/recall`, { method: "POST", json: { query: submitted, k: 6, asOf: debounced } }),
  });
  const now = useQuery({
    enabled: !!submitted,
    queryKey: ["space", space, "tm-now", submitted],
    queryFn: () => api<RecallRes>(`/api/app/spaces/${space}/recall`, { method: "POST", json: { query: submitted, k: 6, includeSuperseded: false } }),
  });
  const [proof, setProof] = useState<RecallRes | null>(null);
  const [proving, setProving] = useState(false);
  const [proofErr, setProofErr] = useState<unknown>(null);
  const prove = async () => {
    setProving(true); setProofErr(null);
    try { setProof(await api<RecallRes>(`/api/app/spaces/${space}/recall`, { method: "POST", json: { query: submitted, k: 6, asOf, verify: true } })); }
    catch (e) { setProofErr(e); } finally { setProving(false); }
  };
  useEffect(() => setProof(null), [asOf, submitted]);

  const nowIds = new Set(now.data?.memories.map((m) => m.id));
  const thenIds = new Set(then.data?.memories.filter((m) => m.status !== "forgotten" || m.validAtAsOf).map((m) => m.id));
  const days = useMemo(() => {
    const out: number[] = [];
    const d0 = new Date(start); d0.setUTCHours(12, 0, 0, 0);
    for (let x = d0.getTime(); x < end; x += 86_400_000) if (x > start) out.push(x);
    return out.slice(-8);
  }, [start, end]);

  return (
    <div className="space-y-4">
      <PageHeader title="Time Machine">Ask what the agents knew at any moment. Recall runs as of the handle: only memories created by then and still valid then.</PageHeader>
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()); }} className="flex gap-2">
        <Input aria-label="Question" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What plan is Ada on?" className="h-10" />
        <Button type="submit" variant="primary" className="h-10">Ask</Button>
      </form>

      <Card title={asOf ? `As of ${when(asOf, { year: true })} UTC` : "Timeline"}>
        <div className="p-4">
          {t.isLoading || pos == null ? <Skeleton className="h-20" /> : (
            <>
              <Timeline start={start} end={end} pos={pos} onChange={setPos} ticks={t.data?.ticks ?? []} />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {days.map((d) => <Button key={d} size="sm" variant="ghost" onClick={() => setPos(d)}>{day(new Date(d).toISOString())}</Button>)}
                <Button size="sm" variant="ghost" onClick={() => setPos(end)}>Now</Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {!submitted ? <Card><Empty title="Ask a question to travel in time">Drag the handle and watch the answer change.</Empty></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Then · ${asOf ? when(asOf) : ""}`} state="sealed" action={<Button size="sm" variant="gold" onClick={prove} loading={proving}><IconSeal /> Prove it</Button>}>
            <div className="space-y-2 p-4">
              <ErrorNote error={then.error || proofErr} />
              {proof && (
                <div className="rounded-[2px] border border-gold/50 bg-gold/5 px-3 py-2 text-2xs text-gold anim-stamp">
                  Replayed {proof.replayed} chain entries from #0 instead of trusting derived fields.{" "}
                  {proof.memories.map((m) => m.id).join() === (then.data?.memories.map((m) => m.id).join() ?? "") ? "Same answer." : "Answer differs from the fast path."}
                  {proof.checkpoint && ` Latest checkpoint ${proof.checkpoint.fileId} covers ${proof.checkpoint.size} entries.`}
                </div>
              )}
              {then.isLoading && <Skeleton className="h-16" />}
              {then.data?.memories.map((m) => <Row key={m.id} m={m} onOpen={open} label={!nowIds.has(m.id) ? (m.status === "forgotten" ? "forgotten since" : m.status === "superseded" ? `superseded${m.supersededBy ? ` by #${Number(m.supersededBy.slice(-12))}` : ""}` : null) : null} fade={then.isFetching} />)}
              {then.data && !then.data.memories.length && <p className="py-6 text-center text-xs text-muted">Nothing relevant was known yet.</p>}
            </div>
          </Card>
          <Card title="Now">
            <div className="space-y-2 p-4">
              {now.isLoading && <Skeleton className="h-16" />}
              {now.data?.memories.map((m) => <Row key={m.id} m={m} onOpen={open} label={!thenIds.has(m.id) ? "new since" : null} />)}
              {now.data && !now.data.memories.length && <p className="py-6 text-center text-xs text-muted">Nothing relevant is known now.</p>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ m, onOpen, label, fade }: { m: RecallMemory; onOpen: (id: string) => void; label: string | null; fade?: boolean }) {
  return (
    <button onClick={() => onOpen(m.id)} className={cx("panel block w-full px-3 py-2 text-left transition-opacity hover:border-accent/60", label && "anim-pulse", fade && "opacity-60", m.status === "forgotten" && "border-dashed")}>
      <div className="flex items-start justify-between gap-2">
        <p className={cx("text-sm", m.status === "forgotten" && "italic text-muted")}>{m.text ?? m.note}</p>
        <span className="text-2xs tabular text-muted">#{m.seq}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <span>{m.agentName} · {when(m.createdAt)}</span>
        {m.conflict && m.status === "active" && <Pill tone="conflict">conflict</Pill>}
        {label && <Pill tone={label.startsWith("new") ? "accent" : label.startsWith("forgotten") ? "forgotten" : "superseded"}>{label}</Pill>}
      </div>
    </button>
  );
}

function Timeline({ start, end, pos, onChange, ticks }: { start: number; end: number; pos: number; onChange: (v: number) => void; ticks: Ticks["ticks"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const frac = (x: number) => Math.min(1, Math.max(0, (x - start) / (end - start)));
  const fromEvent = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(start + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (end - start));
  };
  const onKey = (e: KeyboardEvent) => {
    const stepH = e.shiftKey ? 24 : 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); onChange(Math.max(start, pos - stepH * 3_600_000)); }
    if (e.key === "ArrowRight") { e.preventDefault(); onChange(Math.min(end, pos + stepH * 3_600_000)); }
    if (e.key === "Home") onChange(start);
    if (e.key === "End") onChange(end);
  };
  return (
    <div ref={ref} className="relative h-20 cursor-pointer select-none touch-none" onPointerDown={(e) => { drag.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); fromEvent(e); }}
      onPointerMove={(e) => drag.current && fromEvent(e)} onPointerUp={() => (drag.current = false)}>
      <div className="absolute inset-x-0 top-10 h-px bg-line-2" />
      {ticks.map((t) => {
        const tall = t.superseding || t.op === "forget" || t.op === "link";
        const color = t.op === "forget" ? "bg-muted" : t.op === "link" ? "bg-gold" : t.superseding ? "bg-accent" : "bg-line-2";
        return <span key={t.seq} className={cx("absolute w-px", color)} style={{ left: `${frac(Date.parse(t.at)) * 100}%`, top: tall ? 22 : 32, height: tall ? 36 : 16 }} title={`#${t.seq} ${t.op} ${when(t.at)}`} />;
      })}
      <div className="absolute inset-y-0 left-0 bg-gold/5" style={{ width: `${frac(pos) * 100}%` }} />
      <div role="slider" tabIndex={0} aria-label="As of" aria-valuemin={start} aria-valuemax={end} aria-valuenow={Math.round(pos)} aria-valuetext={when(new Date(pos).toISOString())} onKeyDown={onKey}
        className="absolute top-2 -ml-[9px] flex flex-col items-center" style={{ left: `${frac(pos) * 100}%` }}>
        <span className="flex size-[18px] items-center justify-center rounded-full border-2 border-gold bg-bg text-gold shadow"><IconClock size={10} /></span>
        <span className="h-12 w-px bg-gold" />
      </div>
      <div className="absolute bottom-0 left-0 text-2xs text-muted">{when(new Date(start).toISOString())}</div>
      <div className="absolute bottom-0 right-0 text-2xs text-muted">now</div>
    </div>
  );
}
