/** Reflect: summarise a concept into a summary memory that links to its sources. */
import { generateText } from "ai";
import { iso, type EntryMeta } from "@engram/core";
import { append, queryAll } from "./chain";
import { conceptMembers, type ConceptMeta } from "./concepts";
import type { Ctx } from "./context";
import { embedDocument } from "./embed";
import { EngramError } from "./errors";
import { DATA_BEGIN, DATA_END, DATA_RULE, modelFor, promptValue } from "./relate";

/**
 * Summaries are always written as this system author, whoever asked for them: the text restates other agents'
 * memories, and must not read as something the requesting person (or the reflect job) asserted. Sources are
 * named in `refs.derivedFrom` (hashed) and their writers in the derived `sourceAgents` field.
 */
export const REFLECT_AGENT = "system:reflect";

export async function reflect(ctx: Ctx, conceptId: string) {
  const c = await ctx.b.vectors.get<ConceptMeta>("concepts", conceptId);
  if (!c || c.metadata.space !== ctx.space.key) throw new EngramError("not_found", "Concept not found.");
  const members = (await conceptMembers(ctx, conceptId)).filter((m) => m.metadata.d.status === "active" && m.metadata.op === "remember" && m.metadata.c.text);
  if (members.length < 2) throw new EngramError("bad_request", "A concept needs at least two active memories to reflect on.");
  const sources = members.slice(0, 20);
  // Earlier summaries of the same memories: skip when nothing changed, otherwise replace them. Every page, so an
  // older summary past the first page is still found and replaced.
  const ids = new Set(sources.map((m) => m.$id));
  const previous = (await queryAll<EntryMeta>(ctx.b, "memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.op", values: ["reflect"] }, { op: "eq", path: "metadata.status", values: ["active"] }],
  })).filter((r) => {
    const from = r.metadata.h.refs.derivedFrom;
    return from.filter((x) => ids.has(x)).length * 2 >= Math.max(from.length, 1);
  });
  const same = previous.find((r) => r.metadata.h.refs.derivedFrom.length === ids.size && r.metadata.h.refs.derivedFrom.every((x) => ids.has(x)));
  if (same) return { id: same.$id, seq: Number(same.metadata.seq), summary: same.metadata.c.text ?? "", sources: ids.size, at: iso(), unchanged: true };
  let summary = `Summary of ${c.metadata.label || "a concept"}: ${sources.slice(0, 3).map((m) => m.metadata.c.text).join(" ")}`.slice(0, 1900);
  const model = modelFor(ctx);
  if (model) {
    try {
      const res = await generateText({
        model, abortSignal: AbortSignal.timeout(15_000),
        system: `Summarise these memories into 2-4 plain sentences of durable knowledge. Prefer the latest facts. No speculation. ${DATA_RULE}`,
        prompt: [DATA_BEGIN, ...sources.map((m) => `- (${m.metadata.createdAt.slice(0, 10)}) text ${promptValue(m.metadata.c.text ?? "")}`), DATA_END].join("\n"),
      });
      if (res.text.trim()) summary = res.text.trim().slice(0, 1900);
    } catch (e) { console.warn("[engram] reflect model failed", e); }
  }
  const vector = await embedDocument(ctx, summary);
  const subjects = new Set(sources.map((m) => m.metadata.subject));
  const res = await append(ctx, {
    op: "reflect", kind: "summary", subject: subjects.size === 1 ? [...subjects][0] : null, text: summary, vector,
    importance: 6, refs: { derivedFrom: sources.map((m: { $id: string; metadata: EntryMeta }) => m.$id), supersedes: previous.map((r) => r.$id) },
    agent: REFLECT_AGENT,
    extra: { sourceAgents: [...new Set(sources.map((m) => m.metadata.agent))] },
  });
  return { id: res.id, seq: res.seq, summary, sources: sources.length, at: iso(), unchanged: false };
}
