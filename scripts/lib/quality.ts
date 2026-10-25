/** Scoring harness for the quality fixtures (scripts/fixtures/quality.ts). Pure apart from the injected classifier and embedder. */
import { cosine } from "@engram/core";
import { effective, heuristicRelate, relate, type Ctx, type EngramConfig, type Neighbour, type NewMemory, type Relation, type RelationKind } from "@engram/server";
import type { RecallMemory, RecallQuery, RelationPair } from "../fixtures/quality";

/** Gate from the build spec: the classifier must get at least 22 of the 30 pairs right. */
export const CLASSIFIER_GATE = 22;
export const RECALL_K = 3;
const KINDS: RelationKind[] = ["duplicate", "supersedes", "contradicts", "refines", "unrelated"];

export interface Verdict { relation: RelationKind | "pending"; raw: Relation | null; via: string }
export type Classify = (m: NewMemory, n: Neighbour) => Promise<{ relations: Relation[]; status: string; via: string }>;

export const toInputs = (p: RelationPair): [NewMemory, Neighbour] => [
  { text: p.next.text, kind: p.kind, subject: p.subject, createdAt: p.next.at, agentName: p.next.agent },
  // Distance well above any duplicate threshold, so the fast path never answers for the classifier.
  { id: `old-${p.id}`, text: p.existing.text, createdAt: p.existing.at, agent: `agent:${p.existing.agent}`, agentName: p.existing.agent, subject: p.subject, kind: p.kind, distance: 0.3 },
];

/** What the engine acts on: the relation that clears its confidence threshold, else "unrelated". */
export function verdictOf(res: { relations: Relation[]; status: string; via: string }): Verdict {
  if (res.status === "pending") return { relation: "pending", raw: null, via: res.via };
  const raw = res.relations[0] ?? null;
  return { relation: effective(res.relations)[0]?.relation ?? "unrelated", raw, via: res.via };
}

export interface RelationScore {
  correct: number; total: number; via: string[];
  perClass: Record<RelationKind, { correct: number; total: number }>;
  rows: { id: string; expected: RelationKind; got: string; confidence: number | null; ok: boolean }[];
}

export async function scoreRelations(pairs: RelationPair[], classify: Classify): Promise<RelationScore> {
  const perClass = Object.fromEntries(KINDS.map((k) => [k, { correct: 0, total: 0 }])) as RelationScore["perClass"];
  const rows: RelationScore["rows"] = [];
  const via = new Set<string>();
  for (const p of pairs) {
    const [m, n] = toInputs(p);
    const v = verdictOf(await classify(m, n));
    via.add(v.via);
    const ok = v.relation === p.expected;
    perClass[p.expected].total++;
    if (ok) perClass[p.expected].correct++;
    rows.push({ id: p.id, expected: p.expected, got: v.relation, confidence: v.raw?.confidence ?? null, ok });
  }
  return { correct: rows.filter((r) => r.ok).length, total: rows.length, perClass, rows, via: [...via] };
}

export const heuristicClassifier: Classify = async (m, n) => ({ relations: heuristicRelate(m, [n]), status: "done", via: "heuristic" });

/** The deployment's configured model, through the engine's own relate() (same prompt, schema and thresholds). */
export function modelClassifier(cfg: EngramConfig, timeoutMs = 20_000): Classify {
  const ctx = { cfg, space: { key: "quality0", teamId: "sp_quality0", settings: { duplicateDistance: 0.06, classifierModel: null } } } as unknown as Ctx;
  return (m, n) => relate(ctx, m, [n], { timeoutMs });
}

export interface RecallScore { hits: number; top1: number; total: number; mrr: number; k: number; rows: { query: string; expected: string[]; top: string[]; rank: number | null }[] }

export async function scoreRecall(corpus: RecallMemory[], queries: RecallQuery[], embedDocs: (t: string[]) => Promise<number[][]>, embedQuery: (t: string) => Promise<number[]>, k = RECALL_K): Promise<RecallScore> {
  const vecs = await embedDocs(corpus.map((c) => c.text));
  const rows: RecallScore["rows"] = [];
  for (const q of queries) {
    const v = await embedQuery(q.query);
    const ranked = corpus.map((c, i) => [c.id, cosine(v, vecs[i])] as const).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const idx = ranked.findIndex((id) => q.expected.includes(id));
    rows.push({ query: q.query, expected: q.expected, top: ranked.slice(0, k), rank: idx >= 0 ? idx + 1 : null });
  }
  return {
    hits: rows.filter((r) => r.rank !== null && r.rank <= k).length,
    top1: rows.filter((r) => r.rank === 1).length,
    total: rows.length,
    mrr: rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / Math.max(1, rows.length),
    k, rows,
  };
}
