/**
 * Quality gates (build spec, document 5) against the configured classifier model and embeddings.
 *   pnpm quality              # Appwrite embeddings when configured, else the local deterministic embedder
 *   pnpm quality -- --offline # local embedder and rule-based classifier only, no network
 *   pnpm quality -- --record  # also write the quality section of docs/verified.md (the `quality` provisioning step)
 * Exit code 1 when a configured model scores below the gate (22/30).
 */
import "./env";
import { createAppwriteBackend, createLocalBackend, embedDocuments, embedQuery, getConfig, resolveModel, type Backend } from "@engram/server";
import { RECALL_CORPUS, RECALL_QUERIES, RELATION_PAIRS } from "./fixtures/quality";
import { CLASSIFIER_GATE, heuristicClassifier, modelClassifier, scoreRecall, scoreRelations } from "./lib/quality";
import { upsertSection } from "./lib/verified-md";

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const cfg = getConfig();

let b: Backend;
let embedder = "local deterministic (hashing) embedder";
if (!offline && cfg.backend === "appwrite" && !cfg.configError) { b = createAppwriteBackend(cfg); embedder = `Appwrite nomic-embed-text${cfg.embedPrefixes ? " with task prefixes" : ""}`; }
else b = createLocalBackend({ dir: null });

const model = !offline && cfg.classifierModel && resolveModel(cfg.classifierModel, cfg.modelApiKey) ? cfg.classifierModel : null;
const classifier = model ? `${model} (through relate())` : "rule-based classifier (no model configured)";

console.log(`Relations: ${RELATION_PAIRS.length} pairs with ${classifier}`);
const rel = await scoreRelations(RELATION_PAIRS, model ? modelClassifier(cfg) : heuristicClassifier);
for (const r of rel.rows) console.log(`  ${r.ok ? "✓" : "✗"} ${r.id.padEnd(6)} expected ${r.expected.padEnd(11)} got ${r.got}${r.confidence !== null ? ` (${r.confidence.toFixed(2)})` : ""}`);
const gateOk = rel.correct >= CLASSIFIER_GATE;
console.log(`Classifier: ${rel.correct}/${rel.total} (gate ${CLASSIFIER_GATE}/30: ${gateOk ? "pass" : model ? "FAIL" : "not enforced for the rule-based classifier"}); via ${rel.via.join(", ")}`);

console.log(`\nRecall: ${RECALL_QUERIES.length} queries over ${RECALL_CORPUS.length} memories with ${embedder}`);
const rec = await scoreRecall(RECALL_CORPUS, RECALL_QUERIES, (t) => embedDocuments(b, t), (t) => embedQuery({ b }, t));
for (const r of rec.rows) console.log(`  ${r.rank !== null && r.rank <= rec.k ? "✓" : "✗"} ${r.query} → ${r.top.join(", ")} (expected ${r.expected.join("/")}, rank ${r.rank ?? "-"})`);
console.log(`Recall hit rate @${rec.k}: ${rec.hits}/${rec.total}; top-1 ${rec.top1}/${rec.total}; MRR ${rec.mrr.toFixed(3)}`);

if (args.includes("--record")) {
  const per = Object.entries(rel.perClass).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(", ");
  const misses = rel.rows.filter((r) => !r.ok).map((r) => `${r.id} (expected ${r.expected}, got ${r.got})`).join("; ") || "none";
  upsertSection("quality", `## Quality fixtures

Run by the \`quality\` step on ${new Date().toISOString()}. Fixtures: \`scripts/fixtures/quality.ts\`.

| Check | Setup | Score | Gate |
|-------|-------|-------|------|
| Relation accuracy (30 labelled pairs, 6 per relation) | ${classifier} | **${rel.correct}/${rel.total}** (${per}) | ≥ ${CLASSIFIER_GATE}/30: ${gateOk ? "pass" : model ? "**fail**" : "n/a (rule-based)"} |
| Recall hit rate @${rec.k} (15 queries, 40 memories) | ${embedder}, cosine top-${rec.k} | **${rec.hits}/${rec.total}** (top-1 ${rec.top1}/${rec.total}, MRR ${rec.mrr.toFixed(3)}) | reported |

Misclassified: ${misses}.`);
  console.log("\nWrote the quality section of docs/verified.md");
}
process.exit(model && !gateOk ? 1 : 0);
