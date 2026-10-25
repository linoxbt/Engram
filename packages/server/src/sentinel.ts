/** Sentinel: re-verify every space on a schedule, record integrity, alert on new tampering, apply retention. */
import { iso, type EntryMeta } from "@engram/core";
import type { Backend } from "./backend/types";
import { getConfig } from "./config";
import { backgroundDefer, ALL_SCOPES, type Ctx, type SpaceInfo } from "./context";
import { forget } from "./forget";
import { listAllSpaces } from "./spaces";
import { verifyAndRecord } from "./verify";

export type SentinelResult = { space: string; status: string; validThrough: number; findings: number; retained?: number };

/**
 * Spaces least recently checked go first, and no new space starts once `budgetMs` has passed, so a run
 * finishes inside the Function timeout; the next run picks up the skipped ones first.
 */
export async function runSentinel(b: Backend, opts: { spaces?: SpaceInfo[]; retention?: boolean; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 240_000;
  const spaces = [...(opts.spaces ?? (await listAllSpaces(b)))]
    .sort((x, y) => (x.settings.integrity?.checkedAt ?? "").localeCompare(y.settings.integrity?.checkedAt ?? ""));
  const results: SentinelResult[] = [];
  const skipped: string[] = [];
  for (const s of spaces) {
    if (Date.now() - started >= budget) { skipped.push(s.key); continue; }
    try {
      const before = s.settings.integrity?.status;
      const r = await verifyAndRecord(b, s);
      if (r.status === "tampered" && before !== "tampered" && !s.settings.sandbox) {
        await b.jobs.notifyTamper({ spaceKey: s.key, spaceName: s.settings.name, ownerId: s.settings.ownerId || undefined, message: r.findings.find((f) => f.severity === "critical")?.message ?? "Tampering detected." });
      }
      const retained = opts.retention !== false && s.settings.retentionDays > 0 && !s.settings.sandbox ? await applyRetention(b, s) : 0;
      results.push({ space: s.key, status: r.status, validThrough: r.validThrough, findings: r.findings.length, retained });
    } catch (e) {
      console.error(`[engram] sentinel failed for ${s.key}`, e);
      results.push({ space: s.key, status: "error", validThrough: -1, findings: 0 });
    }
  }
  return { results, skipped };
}

/** Retention is implemented as forget entries written by the system, never as deletions. */
export async function applyRetention(b: Backend, space: SpaceInfo): Promise<number> {
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
  const ctx: Ctx = { b, cfg: getConfig(), space, actor: "system:retention", actorName: "retention policy", scopes: ALL_SCOPES, defer: backgroundDefer };
  let n = 0;
  for (const m of old) {
    try { await forget(ctx, { id: m.$id, reason: `Retention policy: older than ${space.settings.retentionDays} days` }); n++; } catch (e) { console.error("[engram] retention forget failed", e); }
  }
  return n;
}
