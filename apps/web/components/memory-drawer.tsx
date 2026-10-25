"use client";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Checkpoint } from "@engram/core";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { walkProof, type ProofStep } from "@/lib/client/proof";
import { when, shortHash } from "@/lib/format";
import { IconCross, IconSeal, IconTick } from "./icons";
import { Button, Drawer, ErrorNote, Field, Hash, Modal, Pill, Skeleton, Tabs, Textarea, useToast } from "./ui";

interface Detail {
  id: string; seq: number; op: string; kind: string; subject: string | null; text: string | null; status: string; conflict: boolean;
  agent: string; agentName: string; createdAt: string; validFrom: string; validTo: string | null; forgottenAt: string | null; forgottenBy: string | null;
  importance: number; confidence: number; source: string | null; model: string; hash: string; prevHash: string; contentHash: string; embHash: string;
  concept: string | null; access: number; lastAccessAt: string | null; relateStatus: string;
  refs: { supersedes: string[]; contradicts: string[]; related: string[]; target: string | null; derivedFrom: string[] };
  supersededBy: string | null; contradictedBy: string[];
  related: { id: string; seq: number; op: string; kind: string; text: string | null; status: string; agentName: string; createdAt: string }[];
  checkpoint: { fileId: string; seq: number; size: number; root: string; createdAt: string } | null;
}

type Tab = "memory" | "provenance" | "relations" | "proof" | "timeline";

export function MemoryDrawer({ spaceKey, id, onClose, onNavigate }: { spaceKey: string; id: string | null; onClose: () => void; onNavigate: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("memory");
  useEffect(() => setTab("memory"), [id]);
  const q = useQuery({ enabled: !!id, queryKey: ["space", spaceKey, "memory", id], queryFn: () => api<Detail>(`/api/app/spaces/${spaceKey}/memories/${id}`) });
  const d = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={
      <div className="flex items-center gap-2">
        <span className="label">Entry</span>
        <span className="tabular text-accent">#{d?.seq ?? (id ? Number(id.slice(-12)) : "")}</span>
        {d && <Pill tone={d.conflict && d.status === "active" ? "conflict" : d.status}>{d.conflict && d.status === "active" ? "conflict" : d.status}</Pill>}
      </div>
    }>
      <Tabs<Tab> value={tab} onChange={setTab} className="mx-4 mt-2" panelClassName="p-4" tabs={[{ id: "memory", label: "Memory" }, { id: "provenance", label: "Provenance" }, { id: "relations", label: "Relations" }, { id: "proof", label: "Proof" }, { id: "timeline", label: "Timeline" }]}>
        {q.isLoading && <div className="space-y-2"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24" /></div>}
        <ErrorNote error={q.error} />
        {d && tab === "memory" && <MemoryTab d={d} spaceKey={spaceKey} onNavigate={onNavigate} />}
        {d && tab === "provenance" && <ProvenanceTab d={d} />}
        {d && tab === "relations" && <RelationsTab d={d} onNavigate={onNavigate} />}
        {d && tab === "proof" && <ProofTab d={d} spaceKey={spaceKey} />}
        {d && tab === "timeline" && <TimelineTab d={d} spaceKey={spaceKey} onNavigate={onNavigate} />}
      </Tabs>
    </Drawer>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[130px_1fr] gap-3 border-b border-line py-2 text-xs"><span className="label pt-0.5">{k}</span><span className="min-w-0 break-words">{children}</span></div>;
}

/** The forget motion: characters dissolve one by one, leaving a dashed outline and the receipt. */
export function Dissolve({ text, run }: { text: string; run: boolean }) {
  const order = useMemo(() => text.split("").map((_, i) => ({ i, d: Math.random() * 900 })), [text]);
  return (
    <span aria-label={run ? "Content erased" : text}>
      {text.split("").map((ch, i) => (
        <span key={i} className="transition-all duration-500" style={{ opacity: run ? 0 : 1, filter: run ? "blur(3px)" : "none", transitionDelay: run ? `${order[i].d}ms` : "0ms" }}>{ch}</span>
      ))}
    </span>
  );
}

function MemoryTab({ d, spaceKey, onNavigate }: { d: Detail; spaceKey: string; onNavigate: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("Erasure requested by the customer");
  const [dissolving, setDissolving] = useState(false);
  const forget = useMutation({
    mutationFn: () => api<{ seq: number; forgetEntryId: string }>(`/api/app/spaces/${spaceKey}/memories/${d.id}/forget`, { method: "POST", json: { reason } }),
    onSuccess: (r) => {
      setConfirm(false);
      setDissolving(true);
      toast(`Content erased. The record of erasure is entry #${r.seq}.`, "ok");
      setTimeout(() => { qc.invalidateQueries({ queryKey: ["space", spaceKey] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); }, 1500);
    },
  });
  const isMemory = d.op === "remember" || d.op === "reflect";
  const erased = d.status === "forgotten" || (isMemory && d.text == null);
  return (
    <div className="space-y-4">
      <div className={clsx("rounded-[2px] border p-4", erased || dissolving ? "border-dashed border-line-2" : "border-line bg-bg")}>
        {isMemory ? (
          erased && !dissolving ? (
            <div className="space-y-1 text-sm text-muted">
              <p>Content erased on {when(d.forgottenAt)}. Receipt kept.</p>
              <p className="text-2xs">Salted fingerprint: <code>{shortHash(d.contentHash, 10, 6)}</code>{d.forgottenBy && <> · erased by <button className="text-accent hover:underline" onClick={() => onNavigate(d.forgottenBy!)}>#{Number(d.forgottenBy.slice(-12))}</button></>}</p>
            </div>
          ) : (
            <p className={clsx("text-base leading-relaxed", d.status === "superseded" && "text-muted")}>
              {dissolving ? <Dissolve text={d.text ?? ""} run /> : d.text}
            </p>
          )
        ) : (
          <p className="text-sm">
            {d.op === "forget" ? "Forget entry" : `Link entry (${d.kind})`} targeting{" "}
            {d.refs.target && <button className="text-accent hover:underline" onClick={() => onNavigate(d.refs.target!)}>#{Number(d.refs.target.slice(-12))}</button>}
            {d.text && <span className="mt-1 block text-xs text-muted">Reason: {d.text}</span>}
          </p>
        )}
        {dissolving && <p className="mt-3 text-xs text-muted anim-fade" style={{ animationDelay: "1.1s" }}>Content erased. Receipt kept.</p>}
      </div>
      <div>
        <Row k="Kind">{d.kind}</Row>
        <Row k="Subject">{d.subject ?? "—"}</Row>
        <Row k="Author">{d.agentName} <span className="text-muted">({d.agent})</span></Row>
        <Row k="Importance">{d.importance}/10 · confidence {d.confidence}/10</Row>
        <Row k="Source">{d.source ?? "—"}</Row>
        <Row k="Valid from">{when(d.validFrom, { seconds: true })}</Row>
        <Row k="Valid until">{d.validTo ? when(d.validTo, { seconds: true }) : d.status === "forgotten" ? `erased ${when(d.forgottenAt)}` : "still valid"}</Row>
        <Row k="Recalled">{d.access} times{d.lastAccessAt ? `, last ${when(d.lastAccessAt)}` : ""}</Row>
        {d.relateStatus === "pending" && <Row k="Check"><Pill tone="pending">contradiction check pending</Pill></Row>}
      </div>
      {isMemory && !erased && !dissolving && (
        <div className="flex justify-end">
          <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>Forget this memory</Button>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Forget memory #${d.seq}`}>
        <div className="space-y-3">
          <p className="text-xs text-muted">The text, its salt and its vector are erased for good. A forget entry records when and by whom. The chain still verifies because the header covers a salted fingerprint, not the text.</p>
          <Field label="Reason (stored on the forget entry)" help="Do not repeat the content you are erasing.">
            <Textarea rows={2} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={forget.error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" loading={forget.isPending} onClick={() => forget.mutate()}>Erase permanently</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ProvenanceTab({ d }: { d: Detail }) {
  return (
    <div>
      <Row k="Seq">{d.seq}</Row>
      <Row k="ID"><Hash value={d.id} full /></Row>
      <Row k="Header hash"><Hash value={d.hash} /></Row>
      <Row k="Previous hash"><Hash value={d.prevHash} /></Row>
      <Row k="Content hash"><Hash value={d.contentHash} /> <span className="text-2xs text-muted">salted</span></Row>
      <Row k="Vector hash"><Hash value={d.embHash} /></Row>
      <Row k="Author">{d.agentName} <span className="text-muted">{d.agent}</span></Row>
      <Row k="Created">{when(d.createdAt, { seconds: true, year: true })}</Row>
      <Row k="Model">{d.model}</Row>
      <Row k="Checkpoint">{d.checkpoint ? <span className="text-gold">sealed in {d.checkpoint.fileId} ({d.checkpoint.size} entries, {when(d.checkpoint.createdAt)})</span> : <span className="text-muted">not yet covered by a checkpoint</span>}</Row>
      <p className="mt-3 text-2xs text-muted">The header hash covers every immutable field above plus the previous hash. Status, validity and access counts are derived from the chain and checked by replay.</p>
    </div>
  );
}

function RelationsTab({ d, onNavigate }: { d: Detail; onNavigate: (id: string) => void }) {
  const relOf = (id: string) => {
    if (d.refs.supersedes.includes(id)) return { label: "supersedes", tone: "accent" };
    if (d.supersededBy === id) return { label: "superseded by", tone: "superseded" };
    if (d.contradictedBy.includes(id) || d.refs.contradicts.includes(id)) return { label: "conflicts with", tone: "conflict" };
    if (d.refs.target === id) return { label: "target", tone: "gold" };
    if (d.forgottenBy === id) return { label: "erased by", tone: "forgotten" };
    if (d.refs.derivedFrom.includes(id)) return { label: "derived from", tone: "violet" };
    return { label: "related", tone: "violet" };
  };
  if (!d.related.length) return <p className="py-8 text-center text-xs text-muted">No relations. This memory stands alone.</p>;
  return (
    <div className="space-y-4">
      <svg viewBox="0 0 400 120" className="w-full" role="img" aria-label="Relations graph">
        <rect x="170" y="45" width="60" height="30" rx="2" fill="none" stroke="#0a0a0a" strokeWidth="2" />
        <text x="200" y="64" textAnchor="middle" fill="#0a0a0a" fontSize="11" fontFamily="JetBrains Mono">#{d.seq}</text>
        {d.related.slice(0, 6).map((r, i) => {
          const x = 20 + (i % 3) * 140 + (i >= 3 ? 70 : 0) - (i >= 3 ? 70 : 0);
          const y = i < 3 ? 5 : 90;
          const rel = relOf(r.id);
          const color = rel.tone === "conflict" ? "#d7263d" : rel.tone === "gold" ? "#946d00" : rel.tone === "superseded" ? "#686868" : rel.tone === "violet" ? "#45454d" : "#0a0a0a";
          return (
            <g key={r.id} className="cursor-pointer" onClick={() => onNavigate(r.id)}>
              <line x1="200" y1={y < 45 ? 45 : 75} x2={x + 40} y2={y < 45 ? y + 25 : y} stroke={color} strokeWidth="1" strokeDasharray={rel.tone === "superseded" ? "3 3" : undefined} />
              <rect x={x} y={y} width="80" height="25" rx="2" fill="#ffffff" stroke={color} />
              <text x={x + 40} y={y + 16} textAnchor="middle" fill={color} fontSize="10" fontFamily="JetBrains Mono">#{r.seq} {rel.label.split(" ")[0]}</text>
            </g>
          );
        })}
      </svg>
      <ul className="space-y-2">
        {d.related.map((r) => {
          const rel = relOf(r.id);
          return (
            <li key={r.id}>
              <button onClick={() => onNavigate(r.id)} className="panel w-full px-3 py-2 text-left hover:border-accent/60">
                <div className="flex items-center gap-2 text-2xs text-muted"><Pill tone={rel.tone}>{rel.label}</Pill><span className="tabular">#{r.seq}</span><span>{r.agentName}</span><span>{when(r.createdAt)}</span></div>
                <p className={clsx("mt-1 text-xs", r.status === "superseded" && "text-muted line-through")}>{r.op === "forget" ? "Forget entry" : r.op === "link" ? `Link entry (${r.kind})` : r.text ?? "Content erased."}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProofTab({ d, spaceKey }: { d: Detail; spaceKey: string }) {
  const info = useSpaceInfo(spaceKey);
  const [state, setState] = useState<{ steps: ProofStep[]; shown: number; rootOk: boolean | null; sigOk: boolean | null; error: string | null; running: boolean }>({ steps: [], shown: 0, rootOk: null, sigOk: null, error: null, running: false });
  const run = async () => {
    setState({ steps: [], shown: 0, rootOk: null, sigOk: null, error: null, running: true });
    try {
      const p = await api<{ leaf: string; index: number; path: string[]; checkpoint: Checkpoint & { file: string }; publicKey: string | null }>(`/api/app/spaces/${spaceKey}/memories/${d.id}/proof`);
      const res = await walkProof({ leaf: p.leaf, index: p.index, size: Number(p.checkpoint.size), path: p.path, checkpoint: p.checkpoint, publicKey: info.data?.publicKey ?? p.publicKey });
      for (let i = 1; i <= res.steps.length; i++) {
        setState((s) => ({ ...s, steps: res.steps, shown: i }));
        await new Promise((r) => setTimeout(r, 160));
      }
      setState((s) => ({ ...s, rootOk: res.rootOk, sigOk: res.sigOk, running: false }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), running: false }));
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Fetches the Merkle path from this entry to the latest signed checkpoint and recomputes every step in your browser, then checks the Ed25519 signature with the public key.</p>
      <Button variant="gold" onClick={run} loading={state.running}><IconSeal /> Verify this memory</Button>
      {state.error && <p className="text-xs text-warn">{state.error}</p>}
      <ol className="space-y-1.5">
        {state.steps.slice(0, state.shown).map((s, i) => (
          <li key={i} className="panel flex items-center gap-2 px-3 py-1.5 text-2xs anim-slide-in">
            <IconTick size={11} className="text-valid" />
            <span className="w-16 text-muted">{s.label}</span>
            {s.sibling && <span className="text-muted">{s.side === "L" ? "← " : "→ "}{shortHash(s.sibling)}</span>}
            <span className="ml-auto tabular">{shortHash(s.hash)}</span>
          </li>
        ))}
      </ol>
      {state.rootOk != null && (
        <div className={clsx("rounded-[2px] border px-3 py-2 text-xs", state.rootOk && state.sigOk !== false ? "border-gold/60 text-gold anim-stamp" : "border-tamper/60 text-tamper")}>
          {state.rootOk ? <IconTick className="mr-1 inline" /> : <IconCross className="mr-1 inline" />}
          {state.rootOk ? "Root matches the signed checkpoint. " : "Root does not match the checkpoint. "}
          {state.sigOk == null ? "No public key configured to check the signature." : state.sigOk ? "Signature valid." : "Signature INVALID."}
        </div>
      )}
    </div>
  );
}

function TimelineTab({ d, spaceKey, onNavigate }: { d: Detail; spaceKey: string; onNavigate: (id: string) => void }) {
  const q = useQuery({ enabled: !!d.subject, queryKey: ["space", spaceKey, "timeline", d.subject], queryFn: () => api<{ entries: { id: string; seq: number; op: string; kind: string; text: string | null; status: string; createdAt: string; agentName: string; target: string | null }[] }>(`/api/app/spaces/${spaceKey}/timeline?subject=${encodeURIComponent(d.subject!)}`) });
  if (!d.subject) return <p className="py-8 text-center text-xs text-muted">This memory has no subject, so it has no timeline.</p>;
  return (
    <ol className="relative ml-2 border-l border-line-2">
      {q.data?.entries.map((e) => (
        <li key={e.id} className="relative pl-4 pb-3">
          <span className={clsx("absolute -left-[5px] top-1.5 size-2.5 rounded-full border", e.id === d.id ? "border-accent bg-accent" : e.op === "forget" ? "border-dashed border-muted" : e.status === "superseded" ? "border-muted" : "border-accent bg-bg")} />
          <button onClick={() => onNavigate(e.id)} className={clsx("block text-left text-xs", e.id === d.id && "text-accent")}>
            <span className="text-2xs text-muted">#{e.seq} · {when(e.createdAt)} · {e.agentName}</span>
            <span className={clsx("block", e.status === "superseded" && "line-through text-muted", e.status === "forgotten" && "italic text-muted")}>
              {e.op === "forget" ? `forgot #${e.target ? Number(e.target.slice(-12)) : "?"}` : e.op === "link" ? `resolved (${e.kind}) #${e.target ? Number(e.target.slice(-12)) : "?"}` : e.text ?? "content erased"}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
