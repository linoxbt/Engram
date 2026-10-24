import { seqOf, type EntryMeta } from "@engram/core";
import { agentNames, requireScope } from "./agents";
import type { Ctx } from "./context";
import { TimelineInput } from "./schemas";

export interface TimelineEntry {
  seq: number; id: string; op: string; kind: string; text: string | null; status: string; createdAt: string;
  agent: string; agentName: string; target: string | null;
  relations: { supersedes: string[]; contradicts: string[]; related: string[]; supersededBy: string | null; contradictedBy: string[] };
}

/** Every entry about a subject in chain order, including superseded, forgotten, forget and link entries. */
export async function timeline(ctx: Ctx, raw: unknown): Promise<{ subject: string; entries: TimelineEntry[] }> {
  requireScope(ctx, "recall");
  const input = TimelineInput.parse(raw);
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.subject", values: [input.subject] }],
    order: { field: "$id", dir: "asc" }, limit: input.limit, withVectors: false,
  });
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  return {
    subject: input.subject,
    entries: docs.map((d) => {
      const m = d.metadata;
      return {
        seq: seqOf(d.$id), id: d.$id, op: m.op, kind: m.kind, text: m.c.text, status: m.d.status, createdAt: m.createdAt,
        agent: m.agent, agentName: names[m.agent] ?? m.agent, target: m.h.refs.target,
        relations: { supersedes: m.h.refs.supersedes, contradicts: m.h.refs.contradicts, related: m.h.refs.related, supersededBy: m.d.supersededBy, contradictedBy: m.d.contradictedBy },
      };
    }),
  };
}
