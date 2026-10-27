/** Input schemas shared by the REST API, the MCP server and the dashboard. */
import { z } from "zod";

export const MEMORY_KINDS = ["fact", "preference", "event", "observation"] as const;
export const RECALL_KINDS = ["fact", "preference", "event", "observation", "summary"] as const;
export const SUBJECT_RE = /^[a-z0-9_-]+:[a-z0-9_.-]+$/;
/** Every input that names an existing entry is checked the same way, before anything looks it up. */
export const MEMORY_ID = /^m_[a-z0-9]{8}_\d{12}$/;
export const SOURCE_RE = /^[A-Za-z0-9_-]+:\S+$/;
export const SUBJECT_MAX = 80;

const EMAIL_RE = /[^\s@:]+@[^\s@]+\.[^\s@]+/;
/**
 * Phone-number-like: a run of digits and phone punctuation holding seven or more digits, standing on its own (not
 * glued to letters, so "INV-2024-000123" or a UUID's hex groups pass, while "5551234567" and "+44 20 7946 0958"
 * do not).
 */
export function looksLikePhone(s: string): boolean {
  for (const m of s.matchAll(/[\d ().+-]+/g)) {
    if ((m[0].match(/\d/g)?.length ?? 0) < 7) continue;
    const before = s[m.index - 1], after = s[m.index + m[0].length];
    if (!(before && /[A-Za-z]/.test(before)) && !(after && /[A-Za-z]/.test(after))) return true;
  }
  return false;
}
const PUBLIC_HEADER = "is stored in the entry's header, which is permanent and public on spaces with public verification. Use a stable internal ID in type:id form (customer:ada, ticket:4412), never an e-mail address or a phone number.";
const noContactDetails = (field: string) => (s: string, ctx: z.RefinementCtx) => {
  if (EMAIL_RE.test(s) || looksLikePhone(s)) ctx.addIssue({ code: "custom", message: `The ${field} ${PUBLIC_HEADER}` });
};

export const RememberInput = z.object({
  text: z.string().trim().min(3).max(2000),
  kind: z.enum(MEMORY_KINDS).default("fact"),
  subject: z.string().trim().toLowerCase().max(SUBJECT_MAX, `Subjects are limited to ${SUBJECT_MAX} characters.`)
    .regex(SUBJECT_RE, 'Use "type:name", for example customer:ada').superRefine(noContactDetails("subject")).optional(),
  importance: z.number().int().min(0).max(10).default(5),
  confidence: z.number().int().min(0).max(10).default(7),
  source: z.string().trim().max(200).regex(SOURCE_RE, `Use "type:id" for the source, for example ticket:4412. The source ${PUBLIC_HEADER}`)
    .superRefine(noContactDetails("source")).optional(),
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
  id: z.string().regex(MEMORY_ID, "Not a memory ID"),
  /** Stored on the forget entry. Do not repeat the erased content here. */
  reason: z.string().trim().max(200).default("Erasure requested"),
});
export type ForgetInput = z.infer<typeof ForgetInput>;

export const TimelineInput = z.object({
  subject: z.string().trim().toLowerCase().regex(SUBJECT_RE),
  limit: z.number().int().min(1).max(500).default(100),
  /** The `next` value of the previous page. */
  cursor: z.string().regex(/^m_[a-z0-9]{8}_\d{12}$/, "Not a timeline cursor").optional(),
});
export type TimelineInput = z.infer<typeof TimelineInput>;

export const VerifyInput = z.object({
  id: z.string().regex(MEMORY_ID, "Not a memory ID").optional(),
  mode: z.enum(["standard", "deep"]).default("standard"),
});
export type VerifyInput = z.infer<typeof VerifyInput>;

export const ResolveInput = z.object({
  winnerId: z.string().regex(MEMORY_ID, "Not a memory ID"),
  loserId: z.string().regex(MEMORY_ID, "Not a memory ID"),
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
