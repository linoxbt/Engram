"use client";
import clsx from "clsx";
import { OpIcon } from "./icons";
import { Pill } from "./ui";
import { ago } from "@/lib/format";

export interface FeedItem {
  id: string; seq: number; op: string; kind: string; text: string | null; subject: string | null; agent: string; agentName: string;
  createdAt: string; status: string; conflict: boolean; supersedes: number[]; contradicts: number[]; target: number | null; related: number[];
}

export function RelationChips({ item }: { item: Pick<FeedItem, "op" | "kind" | "supersedes" | "contradicts" | "target" | "related"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {item.supersedes.map((s) => <Pill key={`s${s}`} tone="accent">supersedes #{s}</Pill>)}
      {item.contradicts.map((s) => <Pill key={`c${s}`} tone="conflict">conflicts #{s}</Pill>)}
      {item.related.map((s) => <Pill key={`r${s}`} tone="violet">{item.op === "link" ? "winner" : "refines"} #{s}</Pill>)}
      {item.op === "forget" && item.target != null && <Pill tone="forgotten">forgot #{item.target}</Pill>}
      {item.op === "link" && item.target != null && <Pill tone="gold">{item.kind} #{item.target}</Pill>}
    </span>
  );
}

export function Feed({ items, onOpen, fresh }: { items: FeedItem[]; onOpen?: (id: string) => void; fresh?: Set<string> }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => (
        <li key={it.id} className={clsx(fresh?.has(it.id) && "anim-slide-in")}>
          <button onClick={() => onOpen?.(it.id)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-panel-2">
            <span className={clsx("mt-0.5", it.op === "forget" ? "text-muted" : it.op === "link" ? "text-gold" : it.op === "reflect" ? "text-violet" : "text-accent")}><OpIcon op={it.op} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2 text-2xs text-muted">
                <span className="tabular text-text">#{it.seq}</span>
                <span>{it.agentName}</span>
                <span>·</span>
                <span>{ago(it.createdAt)}</span>
                {it.subject && <span className="truncate">· {it.subject}</span>}
              </span>
              <span className={clsx("mt-0.5 block text-sm", it.status === "superseded" && "strike text-muted", it.status === "forgotten" && "italic text-muted")}>
                {it.op === "forget" ? `Forgot #${it.target}${it.text ? `: ${it.text}` : ""}` : it.op === "link" ? `Resolved: ${it.kind} #${it.target}${it.text ? ` (${it.text})` : ""}` : it.text ?? "Content erased. Receipt kept."}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1">
                <RelationChips item={it} />
                {it.conflict && it.status === "active" && <Pill tone="conflict">open conflict</Pill>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
