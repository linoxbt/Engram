/** Concepts: online clustering of memories, model-written labels, graph data for the concept map. */
import { generateText, Output } from "ai";
import { z } from "zod";
import { conceptId, cosine, count8, iso, normalize, quantize, type EntryMeta } from "@engram/core";
import type { VDoc } from "./backend/types";
import { patchDerived } from "./chain";
import type { Ctx } from "./context";
import { EngramError, isConflict } from "./errors";
import { modelFor } from "./relate";

export interface ConceptMeta {
  space: string;
  label: string;
  summary: string;
  members: string;
  membersN: number;
  labeledAtMembers: string;
  lastMemberAt: string;
  createdAt: string;
}
export type ConceptDoc = VDoc<ConceptMeta>;

const LABEL_AT = new Set([3, 10, 30, 100]);

export async function assignConcept(ctx: Ctx, memoryId: string, vector: number[]): Promise<string> {
  const { b, space } = ctx;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [near] = await b.vectors.query<ConceptMeta>("concepts", { vector, filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], limit: 1 });
    if (near && (near.$distance ?? 1) < space.settings.conceptDistance && near.embeddings) {
      const n = near.metadata.membersN ?? Number(near.metadata.members);
      const c = quantize(normalize(near.embeddings.map((x, i) => (x * n + vector[i]) / (n + 1))));
      const meta: ConceptMeta = { ...near.metadata, members: count8(n + 1), membersN: n + 1, lastMemberAt: iso() };
      try {
        await b.vectors.update("concepts", near.$id, { embeddings: c, metadata: meta }, undefined, { ifUpdatedAt: near.$updatedAt });
      } catch (e) {
        if (isConflict(e) && attempt < 2) continue;
        throw e;
      }
      await patchDerived(b, memoryId, { concept: near.$id });
      if (LABEL_AT.has(n + 1)) ctx.defer(() => labelConcept(ctx, near.$id));
      return near.$id;
    }
    const id = conceptId(space.key);
    const meta: ConceptMeta = { space: space.key, label: "", summary: "", members: count8(1), membersN: 1, labeledAtMembers: count8(0), lastMemberAt: iso(), createdAt: iso() };
    // A new concept gets a cheap rule-based label right away; the model relabels at 3, 10, 30 and 100 members.
    const mem = await b.vectors.get<EntryMeta>("memories", memoryId);
    if (mem?.metadata.c.text) Object.assign(meta, heuristicLabel([mem.metadata.c.text]));
    await b.vectors.create("concepts", id, { embeddings: vector, metadata: meta }, b.teamRead(space.teamId));
    await patchDerived(b, memoryId, { concept: id });
    return id;
  }
  return "";
}

const LabelOutput = z.object({ label: z.string().max(40), summary: z.string().max(200) });

export async function labelConcept(ctx: Ctx, id: string): Promise<{ label: string; summary: string } | null> {
  const { b, space } = ctx;
  const c = await b.vectors.get<ConceptMeta>("concepts", id);
  if (!c || c.metadata.space !== space.key) throw new EngramError("not_found", "Concept not found.");
  const mems = await b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [space.key] }, { op: "eq", path: "metadata.d.concept", values: [id] }, { op: "eq", path: "metadata.status", values: ["active", "superseded"] }],
    order: { field: "$id", dir: "desc" },
    limit: 12,
    withVectors: false,
  });
  const texts = mems.map((m) => m.metadata.c.text).filter((t): t is string => !!t);
  if (!texts.length) return null;
  let out = heuristicLabel(texts);
  const model = modelFor(ctx);
  if (model) {
    try {
      const res = await generateText({
        model,
        system: "Name a cluster of related memories. Give a label of at most 4 words and a one-sentence summary. Return JSON only.",
        prompt: texts.map((t) => `- ${t}`).join("\n"),
        output: Output.object({ schema: LabelOutput }),
        abortSignal: AbortSignal.timeout(8000),
        temperature: 0,
      });
      if (res.output?.label) out = res.output;
    } catch (e) {
      console.warn("[engram] labeler model failed, using heuristic", e instanceof Error ? e.message : e);
    }
  }
  await writeLabel(ctx, id, out, true);
  return out;
}

/** Conditional label write: never overwrite a concurrent member-count update with a stale copy. */
async function writeLabel(ctx: Ctx, id: string, out: { label: string; summary: string }, labeled: boolean) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = await ctx.b.vectors.get<ConceptMeta>("concepts", id);
    if (!c || c.metadata.space !== ctx.space.key) return;
    const meta: ConceptMeta = { ...c.metadata, label: out.label, summary: out.summary, ...(labeled ? { labeledAtMembers: c.metadata.members } : {}) };
    try {
      await ctx.b.vectors.update("concepts", id, { metadata: meta }, undefined, { ifUpdatedAt: c.$updatedAt });
      return;
    } catch (e) {
      if (!isConflict(e) || attempt === 3) throw e;
    }
  }
}

/**
 * After a forget: labels and summaries are built from member text, so they can quote the forgotten memory.
 * Rebuild them from what remains, with the rule-based labeller only (no forgotten text is sent to a model).
 */
export async function scrubConcept(ctx: Ctx, id: string, forgotten: string) {
  const mems = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.d.concept", values: [id] }, { op: "eq", path: "metadata.status", values: ["active", "superseded"] }],
    order: { field: "$id", dir: "desc" },
    limit: 12,
    withVectors: false,
  });
  const texts = mems.filter((m) => m.$id !== forgotten && m.metadata.d.status !== "forgotten").map((m) => m.metadata.c.text).filter((t): t is string => !!t);
  await writeLabel(ctx, id, texts.length ? heuristicLabel(texts) : { label: "Forgotten memories", summary: "" }, false);
}

const STOP = new Set("a an the is are was were be been of to in on at for and or by with from as it its this that he she they his her their our we i has have had will would should can could not no yes about over after before into than then there here what when where who which on per".split(" "));

export function heuristicLabel(texts: string[]): { label: string; summary: string } {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const w of t.split(/[^A-Za-z0-9-]+/)) {
      const k = w.toLowerCase();
      if (k.length < 3 || STOP.has(k) || seen.has(k)) continue;
      seen.add(k);
      counts.set(w[0] === w[0]?.toUpperCase() ? w : k, (counts.get(w) ?? 0) + 1 + (w[0] === w[0]?.toUpperCase() ? 0.5 : 0));
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  const label = top.length ? top.map((w) => w[0].toUpperCase() + w.slice(1)).join(" · ") : "Misc";
  return { label, summary: `${texts.length} related memories, most recent: "${texts[0].slice(0, 120)}"` };
}

export interface GraphNode { id: string; label: string; summary: string; members: number; vector: number[] }
export interface GraphEdge { a: string; b: string; weight: number; conflict: boolean }

export async function conceptGraph(ctx: Ctx): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const { b, space } = ctx;
  const cs = await b.vectors.query<ConceptMeta>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], limit: 500 });
  const nodes: GraphNode[] = cs.map((c) => ({ id: c.$id, label: c.metadata.label || "Unlabelled", summary: c.metadata.summary, members: c.metadata.membersN ?? Number(c.metadata.members), vector: c.embeddings ?? [] }));
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const s = cosine(nodes[i].vector, nodes[j].vector);
    if (s > 0.75) edges.push({ a: nodes[i].id, b: nodes[j].id, weight: s, conflict: false });
  }
  const conflicted = await b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [space.key] }, { op: "eq", path: "metadata.conflict", values: ["true"] }, { op: "eq", path: "metadata.status", values: ["active"] }],
    limit: 200, withVectors: false,
  });
  const conceptOf = new Map(conflicted.map((m) => [m.$id, m.metadata.d.concept]));
  for (const m of conflicted) for (const p of m.metadata.d.contradictedBy) {
    const a = m.metadata.d.concept, c2 = conceptOf.get(p);
    if (a && c2 && a < c2) {
      const e = edges.find((x) => (x.a === a && x.b === c2) || (x.a === c2 && x.b === a));
      if (e) e.conflict = true; else edges.push({ a, b: c2, weight: 0.5, conflict: true });
    }
  }
  return { nodes, edges };
}

export async function conceptMembers(ctx: Ctx, id: string) {
  return ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.d.concept", values: [id] }],
    order: { field: "$id", dir: "desc" }, limit: 100, withVectors: false,
  });
}
