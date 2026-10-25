export type ErrorCode =
  | "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "too_large"
  | "rate_limited" | "chain_busy" | "embeddings_unavailable" | "not_sandbox" | "unavailable" | "cookies_required" | "reauth_required" | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, too_large: 413,
  rate_limited: 429, chain_busy: 503, embeddings_unavailable: 503, not_sandbox: 403, unavailable: 503, cookies_required: 403, reauth_required: 403, internal: 500,
};

export class EngramError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EngramError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

/** Thrown by stores on duplicate IDs and transaction conflicts: the chain's lock signal. */
/** Sensitive account changes (passkeys) need a sign-in within this window. */
export const REAUTH_WINDOW_MS = 10 * 60_000;
export const reauthRequired = () => new EngramError("reauth_required", "For your security, confirm it's you before changing passkeys.");

export class ConflictError extends Error {
  constructor(message = "conflict") { super(message); this.name = "ConflictError"; }
}

// Checked by name, not instanceof: the backend is cached on globalThis, and a bundler may load this module
// more than once, so an error thrown by one copy must still be recognised by another.
const named = (e: unknown, name: string) => e instanceof Error && e.name === name;
export const isEngramError = (e: unknown): e is EngramError => e instanceof EngramError || (named(e, "EngramError") && typeof (e as EngramError).code === "string");
export const isConflict = (e: unknown): e is ConflictError => e instanceof ConflictError || named(e, "ConflictError");

export function toErrorBody(e: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (isEngramError(e)) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return { status: 400, body: { error: { code: "bad_request", message: issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } } };
  }
  console.error("[engram] unexpected error", e);
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong on our side." } } };
}
