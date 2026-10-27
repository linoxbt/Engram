/** Concepts: online clustering of memories, model-written labels, graph data for the concept map. */
import { generateText, Output } from "ai";
import { z } from "zod";
import { conceptId, cosine, count8, iso, normalize, quantize, type EntryMeta } from "@engram/core";
import { LruCache } from "./cache";
import type { VDoc } from "./backend/types";
import { patchDerived, queryAll } from "./chain";
import type { Ctx } from "./context";
import { EngramError, isConflict } from "./errors";
import { DATA_BEGIN, DATA_END, DATA_RULE, modelFor, promptValue } from "./relate";

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
    if (mem?.metadata.c.text && mem.metadata.d.status !== "forgotten") Object.assign(meta, heuristicLabel([mem.metadata.c.text]));
    await b.vectors.create("concepts", id, { embeddings: vector, metadata: meta }, b.teamRead(space.teamId));
    await patchDerived(b, memoryId, { concept: id });
    // A forget that ran while d.concept was still unset could not know this label quotes the memory. Whichever of
    // the two looks second sees the other: forget re-reads d.concept after erasing, and we re-read the status here.
    const after = await b.vectors.get<EntryMeta>("memories", memoryId);
    if (meta.label && (!after || after.metadata.d.status === "forgotten" || after.metadata.c.text == null)) await scrubConcept(ctx, id, memoryId);
    return id;
  }
  return "";
}

// No length caps in the schema: a slightly long answer would fail validation outright; it is trimmed below instead.
const LabelOutput = z.object({ label: z.string(), summary: z.string() });

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
        system: `Name a cluster of related memories. Give a label of at most 4 words and a one-sentence summary. Return JSON only. ${DATA_RULE}`,
        prompt: [DATA_BEGIN, ...texts.map((t) => `- text ${promptValue(t)}`), DATA_END].join("\n"),
        output: Output.object({ schema: LabelOutput }),
        abortSignal: AbortSignal.timeout(8000),
      });
      if (res.output?.label.trim()) out = { label: res.output.label.trim().slice(0, 40), summary: res.output.summary.trim().slice(0, 200) };
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
      const key = w[0] === w[0]?.toUpperCase() ? w : k;
      counts.set(key, (counts.get(key) ?? 0) + 1 + (w[0] === w[0]?.toUpperCase() ? 0.5 : 0));
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  const label = top.length ? top.map((w) => w[0].toUpperCase() + w.slice(1)).join(" · ") : "Misc";
  return { label, summary: `${texts.length} related memories, most recent: "${texts[0].slice(0, 120)}"` };
}

export interface GraphNode { id: string; label: string; summary: string; members: number; vector: number[] }
export interface GraphEdge { a: string; b: string; weight: number; conflict: boolean }

/** The map draws every concept up to this many (edges are pairwise); beyond it the answer says it is truncated. */
const GRAPH_MAX = 1000;
/** How close two concepts must be to be drawn as neighbours. */
const GRAPH_EDGE = 0.75;
/** Dimensions scored before the bound below is checked again. */
const BLOCK = 64;

/**
 * Every pair over the threshold, without scoring every dimension of every pair.
 *
 * Dimensions are first put in order of how much of the whole set's mass they carry, so the opening block holds
 * most of what any pair can score (about three quarters of it, measured). After the first d dimensions the rest
 * of the dot product can add at most |tail(a)| * |tail(b)| (Cauchy-Schwarz), so once the running sum plus that
 * bound cannot reach the threshold the pair is dropped and the remaining dimensions are never touched. Norms are
 * taken once per vector rather than once per pair. Exactly the edges a plain cosine over every pair gives.
 */
export function similarEdges(nodes: GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const dim = nodes.find((n) => n.vector.length)?.vector.length ?? 0;
  if (!dim) return edges;
  const mass = new Float64Array(dim);
  for (const n of nodes) if (n.vector.length === dim) for (let d = 0; d < dim; d++) mass[d] += n.vector[d] * n.vector[d];
  const order = [...mass.keys()].sort((a, b) => mass[b] - mass[a]);

  const blocks = Math.ceil(dim / BLOCK) + 1;
  const vecs: Float64Array[] = [];
  const tails: Float64Array[] = [];
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.vector.length !== dim) continue;
    const v = new Float64Array(dim);
    for (let d = 0; d < dim; d++) v[d] = n.vector[order[d]];
    const tail = new Float64Array(blocks);
    for (let d = dim - 1; d >= 0; d--) tail[Math.floor(d / BLOCK)] += v[d] * v[d];
    for (let k = blocks - 2; k >= 0; k--) tail[k] += tail[k + 1];
    for (let k = 0; k < blocks; k++) tail[k] = Math.sqrt(tail[k]);
    if (!tail[0]) continue; // a zero vector is near nothing
    vecs.push(v); tails.push(tail); ids.push(n.id);
  }

  for (let i = 0; i < vecs.length; i++) {
    const a = vecs[i], ta = tails[i];
    for (let j = i + 1; j < vecs.length; j++) {
      const b = vecs[j], tb = tails[j];
      const floor = GRAPH_EDGE * ta[0] * tb[0];
      let dot = 0, reached = true;
      for (let k = 0, d = 0; d < dim; k++) {
        const end = Math.min(d + BLOCK, dim);
        for (; d < end; d++) dot += a[d] * b[d];
        if (dot + ta[k + 1] * tb[k + 1] <= floor) { reached = false; break; }
      }
      if (reached) edges.push({ a: ids[i], b: ids[j], weight: dot / (ta[0] * tb[0]), conflict: false });
    }
  }
  return edges;
}

/**
 * The similarity edges of a space, which only change when a concept is added or its vector moves. The conflict
 * overlay below is recomputed every time, so a cached graph never shows a stale conflict.
 */
const graphCache = new LruCache<{ key: string; edges: GraphEdge[] }>(GRAPH_MAX * 20, (v) => Math.max(1, v.edges.length));

export async function conceptGraph(ctx: Ctx): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }> {
  const { b, space } = ctx;
  const all = await queryAll<ConceptMeta>(b, "concepts", { filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], withVectors: true }, GRAPH_MAX + 1);
  const cs = all.slice(0, GRAPH_MAX);
  const nodes: GraphNode[] = cs.map((c) => ({ id: c.$id, label: c.metadata.label || "Unlabelled", summary: c.metadata.summary, members: c.metadata.membersN ?? Number(c.metadata.members), vector: c.embeddings ?? [] }));
  const key = `${cs.length}|${cs.reduce((m, c) => ((c.$updatedAt ?? "") > m ? c.$updatedAt! : m), "")}`;
  const hit = graphCache.get(space.key);
  const cached = hit?.key === key ? hit.edges : similarEdges(nodes);
  if (hit?.key !== key) graphCache.set(space.key, { key, edges: cached });
  // The caller is free to mutate what it gets back (the overlay does), so the cache keeps its own copy.
  const edges: GraphEdge[] = cached.map((e) => ({ ...e }));
  const conflicted = await queryAll<EntryMeta>(b, "memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [space.key] }, { op: "eq", path: "metadata.conflict", values: ["true"] }, { op: "eq", path: "metadata.status", values: ["active"] }],
  });
  const conceptOf = new Map(conflicted.map((m) => [m.$id, m.metadata.d.concept]));
  for (const m of conflicted) for (const p of m.metadata.d.contradictedBy) {
    const a = m.metadata.d.concept, c2 = conceptOf.get(p);
    if (a && c2 && a < c2) {
      const e = edges.find((x) => (x.a === a && x.b === c2) || (x.a === c2 && x.b === a));
      if (e) e.conflict = true; else edges.push({ a, b: c2, weight: 0.5, conflict: true });
    }
  }
  return { nodes, edges, truncated: all.length > GRAPH_MAX };
}

/** Members, newest first, every page up to `max`. */
export async function conceptMembers(ctx: Ctx, id: string, max = 5000) {
  return queryAll<EntryMeta>(ctx.b, "memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.d.concept", values: [id] }],
  }, max);
}
