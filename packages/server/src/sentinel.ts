/**
 * Sentinel: re-verify every space on a schedule, record integrity (alerting once per incident), finish work that
 * post-commit tasks left behind, and apply retention.
 */
import { iso, type EntryMeta } from "@engram/core";
import { agentNames } from "./agents";
import type { Backend } from "./backend/types";
import { applyPending, patchDerived } from "./chain";
import { getConfig, scheduleBudgetMs } from "./config";
import { backgroundDefer, ALL_SCOPES, type Ctx, type SpaceInfo } from "./context";
import { forget } from "./forget";
import { retryRelate } from "./remember";
import type { RememberInput } from "./schemas";
import { listAllSpaces } from "./spaces";
import { verifyAndRecord, type VerifyOptions } from "./verify";

export type SentinelResult = {
  space: string; status: string; validThrough: number; findings: number; retained?: number;
  /** Entries whose neighbour updates or erasures were still pending and are now applied. */
  applied?: number;
  /** Writes whose contradiction check never finished and was run again. */
  reclassified?: number;
};

/** A remember whose background classification has not reported back after this long is considered abandoned. */
const PENDING_RELATE_AFTER_MS = 10 * 60_000;
const RECLASSIFY_PER_SPACE = 5;

const systemCtx = (b: Backend, space: SpaceInfo, actor = "system:sentinel", actorName = "sentinel"): Ctx =>
  ({ b, cfg: getConfig(), space, actor, actorName, scopes: ALL_SCOPES, defer: backgroundDefer });

/**
 * Spaces least recently checked go first, and no new space (or retention item) starts once `budgetMs` has passed,
 * so a run finishes inside the Function timeout; the next run picks up the skipped ones first. The budget is capped
 * below the 300 s timeout whatever the caller asks for.
 */
export async function runSentinel(b: Backend, opts: { spaces?: SpaceInfo[]; retention?: boolean; budgetMs?: number; verify?: VerifyOptions } = {}) {
  const started = Date.now();
  const budget = scheduleBudgetMs(opts.budgetMs);
  const deadline = started + budget;
  const spaces = [...(opts.spaces ?? (await listAllSpaces(b)))]
    .sort((x, y) => (x.settings.integrity?.checkedAt ?? "").localeCompare(y.settings.integrity?.checkedAt ?? ""));
  const results: SentinelResult[] = [];
  const skipped: string[] = [];
  for (const s of spaces) {
    if (Date.now() >= deadline) { skipped.push(s.key); continue; }
    try {
      // Erasures and neighbour updates whose after() task died land before verification, so a finished erasure is
      // not reported as "in progress" and an idle space does not keep forgotten text around.
      const { applied } = await applyPending(systemCtx(b, s));
      // recordIntegrity (inside) alerts the owner once per incident, whoever recorded "tampered" first.
      const r = await verifyAndRecord(b, s, "standard", { anchors: true, ...opts.verify });
      const reclassified = await sweepPendingRelate(b, s, deadline);
      const retained = opts.retention !== false && s.settings.retentionDays > 0 && !s.settings.sandbox ? await applyRetention(b, s, deadline) : 0;
      results.push({ space: s.key, status: r.status, validThrough: r.validThrough, findings: r.findings.length, retained, applied, reclassified });
    } catch (e) {
      console.error(`[engram] sentinel failed for ${s.key}`, e);
      results.push({ space: s.key, status: "error", validThrough: -1, findings: 0 });
    }
  }
  return { results, skipped };
}

/**
 * Writes whose contradiction check timed out are re-classified by a post-commit task; if that task died, they would
 * stay "pending" forever. Re-run a bounded number per space, as the writing agent, with the existing retry path.
 */
export async function sweepPendingRelate(b: Backend, space: SpaceInfo, deadline = Infinity): Promise<number> {
  const stale = await b.vectors.query<EntryMeta>("memories", {
    filters: [
      { op: "eq", path: "metadata.space", values: [space.key] },
      { op: "eq", path: "metadata.d.relateStatus", values: ["pending"] },
      { op: "lt", path: "metadata.createdAt", value: iso(Date.now() - PENDING_RELATE_AFTER_MS) },
    ],
    order: { field: "$id", dir: "asc" }, limit: RECLASSIFY_PER_SPACE, withVectors: true,
  });
  if (!stale.length) return 0;
  const names = await agentNames(b, stale.map((d) => d.metadata.agent), space);
  let n = 0;
  for (const d of stale) {
    if (Date.now() >= deadline) break;
    const m = d.metadata;
    try {
      if (m.c.text == null || m.d.status !== "active" || !d.embeddings?.length) {
        await patchDerived(b, d.$id, { relateStatus: "skipped" });
        continue;
      }
      await retryRelate(systemCtx(b, space, m.agent, names[m.agent] ?? m.agent), d.$id, d.embeddings, { text: m.c.text, kind: m.kind as RememberInput["kind"], subject: m.subject ?? undefined });
      n++;
    } catch (e) {
      console.error(`[engram] re-classifying ${d.$id} failed`, e);
    }
  }
  return n;
}

/** Retention is implemented as forget entries written by the system, never as deletions. */
export async function applyRetention(b: Backend, space: SpaceInfo, deadline = Infinity): Promise<number> {
  const cutoff = iso(Date.now() - space.settings.retentionDays * 86_400_000);
  const old = await b.vectors.query<EntryMeta>("memories", {
    filters: [
      { op: "eq", path: "metadata.space", values: [space.key] },
      { op: "eq", path: "metadata.op", values: ["remember", "reflect"] },
      { op: "eq", path: "metadata.status", values: ["active", "superseded"] },
      { op: "lt", path: "metadata.createdAt", value: cutoff },
    ],
    limit: 50, withVectors: false,
  });
  const ctx = systemCtx(b, space, "system:retention", "retention policy");
  let n = 0;
  for (const m of old) {
    // Each forget is several writes; the budget is checked between items, not only between spaces.
    if (Date.now() >= deadline) break;
    try { await forget(ctx, { id: m.$id, reason: `Retention policy: older than ${space.settings.retentionDays} days` }); n++; } catch (e) { console.error("[engram] retention forget failed", e); }
  }
  return n;
}
