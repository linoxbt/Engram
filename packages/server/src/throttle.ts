/**
 * Cost guards for agent-facing work. Verification reads the whole chain (deep mode: every vector too) and records
 * the result as the space's integrity status, so an agent calling verify in a loop would cost a full scan and a
 * state write per call. Per process, a space is verified at most once a minute; calls in between get that result.
 */
import type { Backend } from "./backend/types";
import type { Ctx } from "./context";
import { EngramError } from "./errors";
import { proofFor, verifyTool } from "./verify";

export const VERIFY_INTERVAL_MS = 60_000;
type Mode = "standard" | "deep";
/** verifyTool without an id returns no proof. */
type VerifyBase = Awaited<ReturnType<typeof verifyTool>>;
interface Run { at: number; mode: Mode; result: Promise<VerifyBase> }

const runs = new WeakMap<Backend, Map<string, Run>>();
const runsOf = (b: Backend) => { let m = runs.get(b); if (!m) runs.set(b, (m = new Map())); return m; };

/**
 * The verify tool with a per-space budget: one verification (and integrity write) per minute. A standard request
 * inside the window gets the last result (a deep one covers it); a deep request gets the last deep result, or a
 * 429 if the last run was standard.
 */
export async function verifyThrottled(ctx: Ctx, args: { id?: string; mode?: Mode }, now = Date.now()) {
  const mode: Mode = args.mode ?? "standard";
  const m = runsOf(ctx.b);
  let run = m.get(ctx.space.key);
  if (run && now - run.at < VERIFY_INTERVAL_MS) {
    if (mode === "deep" && run.mode !== "deep") {
      const wait = Math.ceil((run.at + VERIFY_INTERVAL_MS - now) / 1000);
      throw new EngramError("rate_limited", `This space was verified moments ago. Deep verification runs at most once a minute per space: try again in ${wait} s.`);
    }
  } else {
    run = { at: now, mode, result: verifyTool(ctx, { mode }) };
    m.set(ctx.space.key, run);
    run.result.catch(() => { if (m.get(ctx.space.key) === run) m.delete(ctx.space.key); });
  }
  const base = await run.result;
  if (!args.id) return base;
  return { ...base, proof: await proofFor(ctx.b, ctx.space, args.id) };
}
