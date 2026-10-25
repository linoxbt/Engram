/** Input schemas shared by the REST API, the MCP server and the dashboard. */
import { z } from "zod";

export const MEMORY_KINDS = ["fact", "preference", "event", "observation"] as const;
export const RECALL_KINDS = ["fact", "preference", "event", "observation", "summary"] as const;
export const SUBJECT_RE = /^[a-z0-9_-]+:[a-z0-9_.-]+$/;

export const RememberInput = z.object({
  text: z.string().trim().min(3).max(2000),
  kind: z.enum(MEMORY_KINDS).default("fact"),
  subject: z.string().trim().toLowerCase().regex(SUBJECT_RE, 'Use "type:name", for example customer:ada').optional(),
  importance: z.number().int().min(0).max(10).default(5),
  confidence: z.number().int().min(0).max(10).default(7),
  source: z.string().max(200).optional(),
  // No transform here (MCP publishes this schema as JSON Schema); remember() normalises it to 24-char UTC ISO.
  validFrom: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().max(64).optional(),
});
export type RememberInput = z.infer<typeof RememberInput>;

/** Runs even after a failed format check (zod continues), so it must leave unparseable input alone. */
const toIso = (v: string) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : v; };

export const RecallInput = z.object({
  query: z.string().trim().min(2).max(500),
  k: z.number().int().min(1).max(20).default(5),
  // Offsets are accepted like validFrom's and normalised to the chain's 24-char UTC form, which string comparisons
  // against createdAt rely on. overwrite() keeps the type a string, so the published JSON Schema is unchanged.
  asOf: z.string().datetime({ offset: true }).overwrite(toIso).optional(),
  kinds: z.array(z.enum(RECALL_KINDS)).optional(),
  subject: z.string().trim().toLowerCase().optional(),
  agent: z.string().optional(),
  includeSuperseded: z.boolean().default(false),
  /** Replay the chain to compute validity instead of trusting derived fields. */
  verify: z.boolean().default(false),
});
export type RecallInput = z.infer<typeof RecallInput>;

export const ForgetInput = z.object({
  id: z.string().regex(/^m_[a-z0-9]{8}_\d{12}$/, "Not a memory ID"),
  /** Stored on the forget entry. Do not repeat the erased content here. */
  reason: z.string().trim().max(200).default("Erasure requested"),
});
export type ForgetInput = z.infer<typeof ForgetInput>;

export const TimelineInput = z.object({
  subject: z.string().trim().toLowerCase().regex(SUBJECT_RE),
  limit: z.number().int().min(1).max(500).default(100),
});
export type TimelineInput = z.infer<typeof TimelineInput>;

export const VerifyInput = z.object({
  id: z.string().optional(),
  mode: z.enum(["standard", "deep"]).default("standard"),
});
export type VerifyInput = z.infer<typeof VerifyInput>;

export const ResolveInput = z.object({
  winnerId: z.string(),
  loserId: z.string(),
  action: z.enum(["supersede", "refine", "dismiss"]).default("supersede"),
  reason: z.string().trim().max(200).default(""),
});
export type ResolveInput = z.infer<typeof ResolveInput>;

export const CreateAgentInput = z.object({
  name: z.string().trim().min(2).max(48).regex(/^[a-zA-Z0-9 ._-]+$/),
  description: z.string().trim().min(3).max(300),
  scopes: z.array(z.enum(["remember", "recall", "forget", "verify", "resolve"])).min(1).default(["remember", "recall", "verify"]),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export const SettingsInput = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  description: z.string().trim().max(300).optional(),
  neighbourDistance: z.number().min(0.05).max(0.9).optional(),
  duplicateDistance: z.number().min(0).max(0.3).optional(),
  conceptDistance: z.number().min(0.05).max(0.9).optional(),
  checkpointEvery: z.number().int().min(1).max(1000).optional(),
  classifierModel: z.string().max(100).nullable().optional(),
  retentionDays: z.number().int().min(0).max(3650).optional(),
  publicVerify: z.boolean().optional(),
  anchoring: z.boolean().optional(),
});
export type SettingsInput = z.infer<typeof SettingsInput>;
