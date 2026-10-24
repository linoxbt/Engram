/** Reflect: summarise a concept into a summary memory that links to its sources. */
import { generateText } from "ai";
import { iso, type EntryMeta } from "@engram/core";
import { append } from "./chain";
import { conceptMembers, type ConceptMeta } from "./concepts";
import type { Ctx } from "./context";
import { embedDocument } from "./embed";
import { EngramError } from "./errors";
import { resolveModel } from "./relate";

export async function reflect(ctx: Ctx, conceptId: string) {
  const c = await ctx.b.vectors.get<ConceptMeta>("concepts", conceptId);
  if (!c || c.metadata.space !== ctx.space.key) throw new EngramError("not_found", "Concept not found.");
  const members = (await conceptMembers(ctx, conceptId)).filter((m) => m.metadata.d.status === "active" && m.metadata.op === "remember" && m.metadata.c.text);
  if (members.length < 2) throw new EngramError("bad_request", "A concept needs at least two active memories to reflect on.");
  const sources = members.slice(0, 20);
  const texts = sources.map((m) => `- ${m.metadata.c.text} (${m.metadata.createdAt.slice(0, 10)})`);
  let summary = `Summary of ${c.metadata.label || "a concept"}: ${sources.slice(0, 3).map((m) => m.metadata.c.text).join(" ")}`.slice(0, 1900);
  const model = resolveModel(ctx.space.settings.classifierModel ?? ctx.cfg.classifierModel, ctx.cfg.modelApiKey);
  if (model) {
    try {
      const res = await generateText({
        model, temperature: 0, abortSignal: AbortSignal.timeout(15_000),
        system: "Summarise these memories into 2-4 plain sentences of durable knowledge. Prefer the latest facts. No speculation.",
        prompt: texts.join("\n"),
      });
      if (res.text.trim()) summary = res.text.trim().slice(0, 1900);
    } catch (e) { console.warn("[engram] reflect model failed", e); }
  }
  const vector = await embedDocument(ctx, summary);
  const subjects = new Set(sources.map((m) => m.metadata.subject));
  const res = await append(ctx, {
    op: "reflect", kind: "summary", subject: subjects.size === 1 ? [...subjects][0] : null, text: summary, vector,
    importance: 6, refs: { derivedFrom: sources.map((m: { $id: string; metadata: EntryMeta }) => m.$id) },
  });
  return { id: res.id, seq: res.seq, summary, sources: sources.length, at: iso() };
}
