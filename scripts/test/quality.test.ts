import { describe, expect, it } from "vitest";
import { createLocalBackend, embedDocuments, embedQuery, getConfig, type Relation } from "@engram/server";
import { RECALL_CORPUS, RECALL_QUERIES, RELATION_PAIRS } from "../fixtures/quality";
import { CLASSIFIER_GATE, heuristicClassifier, modelClassifier, scoreRecall, scoreRelations, toInputs, type Classify } from "../lib/quality";

describe("quality fixtures", () => {
  it("has 30 relation pairs, 6 per relation, with unique ids and the new memory never earlier", () => {
    expect(RELATION_PAIRS).toHaveLength(30);
    const counts: Record<string, number> = {};
    for (const p of RELATION_PAIRS) counts[p.expected] = (counts[p.expected] ?? 0) + 1;
    expect(counts).toEqual({ duplicate: 6, supersedes: 6, contradicts: 6, refines: 6, unrelated: 6 });
    expect(new Set(RELATION_PAIRS.map((p) => p.id)).size).toBe(30);
    for (const p of RELATION_PAIRS) expect(p.next.at >= p.existing.at).toBe(true);
  });

  it("has a 40-memory corpus and 15 queries whose expected answers exist", () => {
    expect(RECALL_CORPUS).toHaveLength(40);
    expect(RECALL_QUERIES).toHaveLength(15);
    const ids = new Set(RECALL_CORPUS.map((c) => c.id));
    expect(ids.size).toBe(40);
    for (const q of RECALL_QUERIES) for (const e of q.expected) expect(ids.has(e)).toBe(true);
  });
});

describe("quality harness", () => {
  it("scores a perfect classifier 30/30 and a pending one 0/30", async () => {
    const byText = new Map(RELATION_PAIRS.map((p) => [p.next.text + p.existing.text, p.expected]));
    const oracle: Classify = async (m, n) => ({ relations: [{ id: n.id, relation: byText.get(m.text + n.text)!, confidence: 1, reason: "" }], status: "done", via: "oracle" });
    const s = await scoreRelations(RELATION_PAIRS, oracle);
    expect(s.correct).toBe(30);
    expect(Object.values(s.perClass).every((c) => c.correct === 6 && c.total === 6)).toBe(true);
    const pending: Classify = async () => ({ relations: [], status: "pending", via: "model" });
    expect((await scoreRelations(RELATION_PAIRS, pending)).correct).toBe(0);
  });

  it("scores what the engine acts on: a relation below its confidence threshold counts as unrelated", async () => {
    const pair = RELATION_PAIRS.find((p) => p.expected === "contradicts")!;
    const weak: Classify = async (_m, n) => ({ relations: [{ id: n.id, relation: "contradicts", confidence: 0.3, reason: "" } as Relation], status: "done", via: "model" });
    expect((await scoreRelations([pair], weak)).rows[0].got).toBe("unrelated");
  });

  it("runs the fixture through the rule-based classifier (baseline, no network)", async () => {
    const s = await scoreRelations(RELATION_PAIRS, heuristicClassifier);
    expect(s.total).toBe(30);
    expect(s.via).toEqual(["heuristic"]);
    // The rule-based fallback is a safety net, not the gated classifier; this floor catches a broken harness or a
    // badly regressed heuristic. The live model must reach CLASSIFIER_GATE.
    expect(s.correct).toBeGreaterThanOrEqual(12);
    expect(CLASSIFIER_GATE).toBe(22);
  });

  it("without a model, the engine's relate() path falls back to the same rules", async () => {
    const cfg = { ...getConfig(), classifierModel: null, allowedModels: [] };
    const [m, n] = toInputs(RELATION_PAIRS[6]);
    const r = await modelClassifier(cfg)(m, n);
    expect(r.via).toBe("heuristic");
  });

  it("computes recall hit rate with the local deterministic embedder", async () => {
    const b = createLocalBackend({ dir: null });
    const s = await scoreRecall(RECALL_CORPUS, RECALL_QUERIES, (t) => embedDocuments(b, t), (t) => embedQuery({ b }, t));
    expect(s.total).toBe(15);
    expect(s.top1).toBeLessThanOrEqual(s.hits);
    expect(s.hits).toBeGreaterThanOrEqual(10);
    expect(s.mrr).toBeGreaterThan(0.5);
  });
});
