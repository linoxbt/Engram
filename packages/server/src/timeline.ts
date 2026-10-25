import { seqOf, type EntryMeta } from "@engram/core";
import { agentNames, requireScope } from "./agents";
import type { Ctx } from "./context";
import { EngramError } from "./errors";
import { TimelineInput } from "./schemas";

export interface TimelineEntry {
  seq: number; id: string; op: string; kind: string; text: string | null; status: string; createdAt: string;
  agent: string; agentName: string; target: string | null; source: string | null;
  relations: { supersedes: string[]; contradicts: string[]; related: string[]; supersededBy: string | null; contradictedBy: string[] };
  /** Summaries written by the reflect job: the memories they restate and who wrote those. */
  derivedFrom?: string[];
  sourceAgentNames?: string[];
}

/**
 * Every entry about a subject in chain order, including superseded, forgotten, forget and link entries. Paged:
 * `next` is the cursor for the following page (null on the last), so nothing past the limit is silently dropped.
 */
export async function timeline(ctx: Ctx, raw: unknown): Promise<{ subject: string; entries: TimelineEntry[]; next: string | null }> {
  requireScope(ctx, "recall");
  const input = TimelineInput.parse(raw);
  if (input.cursor && !input.cursor.startsWith(`m_${ctx.space.key}_`)) throw new EngramError("bad_request", "That cursor belongs to another space.");
  // One extra row tells whether another page exists without a second query.
  const rows = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.subject", values: [input.subject] }],
    order: { field: "$id", dir: "asc" }, limit: input.limit + 1, cursorAfter: input.cursor, withVectors: false,
  });
  const docs = rows.slice(0, input.limit);
  const next = rows.length > input.limit ? docs[docs.length - 1].$id : null;
  const sourceAgents = (m: EntryMeta) => ((m.d as { sourceAgents?: string[] }).sourceAgents ?? []);
  const names = await agentNames(ctx.b, docs.flatMap((d) => [d.metadata.agent, ...sourceAgents(d.metadata)]), ctx.space);
  return {
    subject: input.subject,
    next,
    entries: docs.map((d) => {
      const m = d.metadata;
      return {
        seq: seqOf(d.$id), id: d.$id, op: m.op, kind: m.kind, text: m.c.text, status: m.d.status, createdAt: m.createdAt,
        agent: m.agent, agentName: names[m.agent] ?? m.agent, target: m.h.refs.target, source: m.h.source,
        relations: { supersedes: m.h.refs.supersedes, contradicts: m.h.refs.contradicts, related: m.h.refs.related, supersededBy: m.d.supersededBy, contradictedBy: m.d.contradictedBy },
        ...(m.op === "reflect" ? { derivedFrom: m.h.refs.derivedFrom, sourceAgentNames: sourceAgents(m).map((a) => names[a] ?? a) } : {}),
      };
    }),
  };
}
