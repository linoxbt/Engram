/** Recall re-ranking: similarity, recency, importance and use, then MMR for diversity. */

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map((x) => x / n) : v.slice();
}

export interface ScoreInput {
  /** Cosine distance from the vector leg, or null for keyword-only hits. */
  distance: number | null;
  createdAt: string;
  importance: number; // 0-10
  access: number;
  conflict: boolean;
  rrf: number; // normalised 0-1
}

export const WEIGHTS = { sim: 0.62, recency: 0.18, importance: 0.12, use: 0.08, rrf: 0.15, conflictPenalty: 0.1 } as const;

export function scoreCandidate(c: ScoreInput, now = Date.now()): { score: number; sim: number } {
  const sim = c.distance == null ? 0.5 : Math.max(0, 1 - c.distance);
  const ageDays = Math.max(0, (now - Date.parse(c.createdAt)) / 86_400_000);
  const recency = Math.exp(-ageDays / 30);
  const importance = Math.max(0, Math.min(10, c.importance)) / 10;
  const use = Math.log(1 + Math.max(0, c.access)) / Math.log(51);
  let score = WEIGHTS.sim * sim + WEIGHTS.recency * recency + WEIGHTS.importance * importance + WEIGHTS.use * Math.min(1, use) + WEIGHTS.rrf * c.rrf;
  if (c.conflict) score -= WEIGHTS.conflictPenalty;
  return { score, sim };
}

/** Reciprocal Rank Fusion over ranked ID lists; normalised so the best is 1. */
export function rrfFuse(legs: string[][], k = 60): Map<string, number> {
  const raw = new Map<string, number>();
  for (const leg of legs) leg.forEach((id, rank) => raw.set(id, (raw.get(id) ?? 0) + 1 / (k + rank + 1)));
  const max = Math.max(0, ...raw.values());
  const out = new Map<string, number>();
  for (const [id, v] of raw) out.set(id, max ? v / max : 0);
  return out;
}

export interface MmrCand { id: string; score: number; vector?: number[] }

/** Maximal Marginal Relevance: pick k items balancing score and novelty. */
export function mmr<T extends MmrCand>(cands: T[], k: number, lambda = 0.7): T[] {
  const chosen: T[] = [];
  const pool = [...cands];
  while (chosen.length < k && pool.length) {
    let best = 0, bestVal = -Infinity;
    pool.forEach((c, i) => {
      const maxSim = chosen.length && c.vector
        ? Math.max(...chosen.map((s) => (s.vector ? cosine(s.vector, c.vector!) : 0)))
        : 0;
      const val = lambda * c.score - (1 - lambda) * maxSim;
      if (val > bestVal) { bestVal = val; best = i; }
    });
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

/** Keyword leg trigger: a capitalised name, an ID-like token, or a quoted phrase. */
export function keywordTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const m of query.matchAll(/"([^"]{2,80})"/g)) terms.add(m[1]);
  for (const m of query.matchAll(/\b([A-Z]{2,}-?\d+|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/g)) {
    const w = m[1];
    if (!STOP.has(w)) terms.add(w);
  }
  for (const m of query.matchAll(/\b[\w-]*\d[\w-]*\b/g)) if (m[0].length >= 3) terms.add(m[0]);
  return [...terms].slice(0, 3);
}
const STOP = new Set(["What", "Who", "When", "Where", "Why", "How", "Which", "Is", "Are", "Does", "Do", "The", "A", "An", "I", "Can", "Should", "Tell", "Find", "List", "Show"]);
