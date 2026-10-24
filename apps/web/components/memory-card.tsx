"use client";
import clsx from "clsx";
import { Pill } from "./ui";
import { when } from "@/lib/format";

export interface RecallMemory {
  id: string; seq: number; text: string | null; kind: string; subject: string | null; agent: string; agentName: string; createdAt: string;
  validFrom: string; validTo: string | null; status: "active" | "superseded" | "forgotten"; validAtAsOf: boolean; conflict: boolean;
  contradictedBy: string[]; supersedes: string[]; supersededBy: string | null; related: string[]; score: number; distance: number | null;
  hash: string; importance: number; source: string | null; checkpoint: { seq: number; file: string } | null; note: string | null;
}

const n = (id: string) => Number(id.slice(-12));

export function MemoryCard({ m, onOpen, asOf, maxScore = 1 }: { m: RecallMemory; onOpen?: (id: string) => void; asOf?: string | null; maxScore?: number }) {
  const statusTone = m.status === "active" ? (m.conflict ? "conflict" : "active") : m.status;
  return (
    <button onClick={() => onOpen?.(m.id)} className={clsx("panel block w-full px-4 py-3 text-left transition-colors hover:border-accent/60", m.status === "forgotten" && "border-dashed")}>
      <div className="flex items-start justify-between gap-3">
        <p className={clsx("text-sm", m.status === "superseded" && !asOf && "text-muted", m.status === "forgotten" && "italic text-muted")}>
          {m.text ?? m.note ?? "Content erased. Receipt kept."}
        </p>
        <span className="shrink-0 text-2xs tabular text-muted">#{m.seq}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <Pill tone={statusTone}>{asOf ? (m.validAtAsOf ? "valid then" : m.status) : m.conflict && m.status === "active" ? "conflict" : m.status}</Pill>
        <Pill tone="accent">{m.kind}</Pill>
        {m.subject && <span>{m.subject}</span>}
        <span>· {m.agentName}</span>
        <span>· {when(m.createdAt)}</span>
        {m.supersedes.map((s) => <Pill key={s} tone="accent">supersedes #{n(s)}</Pill>)}
        {m.supersededBy && <Pill tone="superseded">superseded by #{n(m.supersededBy)}</Pill>}
        {m.contradictedBy.map((s) => <Pill key={s} tone="conflict">conflicts #{n(s)}</Pill>)}
        {m.checkpoint && <Pill tone="gold">sealed</Pill>}
      </div>
      {m.status !== "forgotten" && (
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-line" aria-label={`score ${m.score}`}>
          <div className="h-full bg-accent/55" style={{ width: `${Math.max(4, Math.min(100, (m.score / Math.max(0.01, maxScore)) * 100))}%` }} />
        </div>
      )}
    </button>
  );
}
