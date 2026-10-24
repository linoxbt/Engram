/**
 * Contradiction engine: compare a new memory with its closest active
 * neighbours and decide duplicate / supersedes / contradicts / refines /
 * unrelated. Fast paths first, then one structured model call, then a
 * deterministic heuristic when no model is configured. Never blocks a write.
 */
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { Ctx } from "./context";

export type RelationKind = "duplicate" | "supersedes" | "contradicts" | "refines" | "unrelated";
export interface Neighbour {
  id: string;
  text: string;
  createdAt: string;
  agent: string;
  agentName: string;
  subject: string | null;
  kind: string;
  distance: number;
}
export interface Relation { id: string; relation: RelationKind; confidence: number; reason: string }
export interface RelateResult { relations: Relation[]; status: "done" | "pending" | "skipped"; via: "fast" | "model" | "heuristic" | "none" }

const RelationSchema = z.object({
  id: z.string(),
  relation: z.enum(["duplicate", "supersedes", "contradicts", "refines", "unrelated"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
});
const RelateOutput = z.object({ relations: z.array(RelationSchema) });

export const RELATE_SYSTEM = `You compare a NEW memory written by an AI agent with EXISTING memories from the same shared memory.
For each existing memory, choose exactly one relation:
- duplicate: says the same thing; nothing new.
- supersedes: NEW replaces EXISTING because the world changed or EXISTING was outdated (later date, explicit change).
- contradicts: they disagree and nothing shows which one is right.
- refines: NEW adds detail to EXISTING without making it wrong.
- unrelated: different facts, even if similar words.
Use the timestamps. A later statement about a change supersedes an earlier state.
Return JSON only, matching the schema. Give a reason under 25 words.`;

/** Confidence needed before a relation takes effect. */
export const THRESHOLDS: Record<RelationKind, number> = { duplicate: 0.8, supersedes: 0.7, contradicts: 0.6, refines: 0, unrelated: 0 };

export interface NewMemory { text: string; kind: string; subject: string | null; createdAt: string; agentName: string }

const minute = (iso: string) => iso.slice(0, 16) + "Z";

export function buildPrompt(m: NewMemory, ns: Neighbour[]): string {
  const lines = [
    `NEW (${minute(m.createdAt)}, agent ${m.agentName}${m.subject ? `, subject ${m.subject}` : ""}):`,
    JSON.stringify(m.text),
    "EXISTING:",
    ...ns.map((n) => `[${n.id}] (${minute(n.createdAt)}, agent ${n.agentName}${n.subject ? `, subject ${n.subject}` : ""})\n${JSON.stringify(n.text)}`),
  ];
  return lines.join("\n");
}

export function resolveModel(spec: string | null, apiKey: string | null) {
  if (!spec) return null;
  const [provider, ...rest] = spec.split(/[:/]/);
  const id = rest.join("/") || spec;
  if (provider === "anthropic") {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    return key ? createAnthropic({ apiKey: key })(id) : null;
  }
  if (provider === "openai") {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    return key ? createOpenAI({ apiKey: key })(id) : null;
  }
  return null;
}

export async function relate(ctx: Ctx, m: NewMemory, neighbours: Neighbour[], opts: { timeoutMs?: number } = {}): Promise<RelateResult> {
  if (!neighbours.length) return { relations: [], status: "skipped", via: "none" };
  const s = ctx.space.settings;
  const fast: Relation[] = [];
  const rest: Neighbour[] = [];
  for (const n of neighbours) {
    if (n.distance < s.duplicateDistance && n.kind === m.kind && (n.subject ?? null) === (m.subject ?? null)) {
      fast.push({ id: n.id, relation: "duplicate", confidence: 1, reason: "Nearly identical meaning, same kind and subject." });
    } else if (n.subject && m.subject && n.subject !== m.subject) {
      fast.push({ id: n.id, relation: "unrelated", confidence: 1, reason: "Different subjects." });
    } else rest.push(n);
  }
  if (fast.some((r) => r.relation === "duplicate") || !rest.length) return { relations: fast, status: "done", via: "fast" };

  const model = resolveModel(s.classifierModel ?? ctx.cfg.classifierModel, ctx.cfg.modelApiKey);
  if (!model) return { relations: [...fast, ...heuristicRelate(m, rest)], status: "done", via: "heuristic" };

  const prompt = buildPrompt(m, rest);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await generateText({
        model,
        system: RELATE_SYSTEM,
        prompt,
        output: Output.object({ schema: RelateOutput, name: "relations" }),
        abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
        maxRetries: 0,
        temperature: 0,
      });
      const known = new Set(rest.map((n) => n.id));
      const rels = (res.output?.relations ?? []).filter((r) => known.has(r.id));
      return { relations: [...fast, ...rels], status: "done", via: "model" };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (timedOut || attempt === 1) {
        console.warn("[engram] classifier unavailable, write proceeds as pending:", e instanceof Error ? e.message : e);
        return { relations: fast, status: "pending", via: "model" };
      }
    }
  }
  return { relations: fast, status: "pending", via: "model" };
}

/** Keep only relations whose confidence clears the threshold for their kind. */
export function effective(relations: Relation[]): Relation[] {
  return relations.filter((r) => r.relation !== "unrelated" && r.confidence >= THRESHOLDS[r.relation]);
}

// ---------------------------------------------------------------- heuristic

const CHANGE = /\b(downgrad\w*|upgrad\w*|chang\w*|switch\w*|mov(ed|es|ing)\b|cancel\w*|no longer|replac\w*|updat\w*|became|renam\w*|left|joined|now|instead|terminat\w*|ended|resign\w*|promot\w*|relocat\w*)\b/i;
const ATTRS = ["plan", "address", "email", "phone", "role", "price", "status", "owner", "deadline", "tier", "budget", "manager", "contract", "lead", "contact", "office", "timezone", "language"];
const STOP = new Set("a an the is are was were be of to in on at for and or by with from as it its this that he she they his her their our we i".split(" "));

const words = (t: string) => t.toLowerCase().replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
const values = (t: string) => new Set((t.match(/\b[A-Z][a-zA-Z0-9-]+\b/g) ?? []).map((w) => w.toLowerCase()));
const norm = (t: string) => words(t).join(" ");

export function heuristicRelate(m: NewMemory, ns: Neighbour[]): Relation[] {
  const nw = new Set(words(m.text));
  return ns.map((n) => {
    if (norm(n.text) === norm(m.text)) return { id: n.id, relation: "duplicate" as const, confidence: 0.95, reason: "Same statement." };
    const ow = new Set(words(n.text));
    const shared = [...nw].filter((w) => ow.has(w));
    const overlap = shared.length / Math.max(1, Math.min(nw.size, ow.size));
    const attr = ATTRS.find((a) => nw.has(a) && ow.has(a));
    const later = m.createdAt >= n.createdAt;
    if (overlap < 0.2 && !attr) return { id: n.id, relation: "unrelated" as const, confidence: 0.7, reason: "Little in common." };
    if (CHANGE.test(m.text) && later && (attr || overlap >= 0.3)) {
      return { id: n.id, relation: "supersedes" as const, confidence: 0.8, reason: `New statement reports a change${attr ? ` to the ${attr}` : ""}.` };
    }
    if (attr) {
      const nv = values(m.text), ov = values(n.text);
      const differs = [...nv].some((v) => !ov.has(v)) || [...ov].some((v) => !nv.has(v));
      if (differs) return { id: n.id, relation: "contradicts" as const, confidence: 0.7, reason: `They state different values for the ${attr}.` };
    }
    return { id: n.id, relation: overlap >= 0.5 ? ("refines" as const) : ("unrelated" as const), confidence: 0.55, reason: overlap >= 0.5 ? "Adds detail to the same fact." : "Similar words, different facts." };
  });
}
