/** Scheduled reflect runs: bounded by a time budget, fair across spaces, and honest about failures. */
import type { EntryMeta } from "@engram/core";
import type { Backend } from "./backend/types";
import type { ConceptMeta } from "./concepts";
import { getConfig } from "./config";
import { ALL_SCOPES, backgroundDefer, type Ctx, type SpaceInfo } from "./context";
import { isEngramError } from "./errors";
import { reflect } from "./reflect";

export type ReflectRunResult = { space: string; concept: string; seq: number };
export type ReflectRunError = { space: string; concept: string | null; message: string };

/**
 * Spaces whose newest summary is oldest go first (never-reflected first); no new space or concept starts once
 * `budgetMs` has passed. Concepts that cannot be summarised (too few active memories) are not errors; anything
 * else is reported in `errors` so the Function can fail the execution.
 */
export async function runScheduledReflect(b: Backend, spaces: SpaceInfo[], opts: { budgetMs: number; concept?: string; minMembers?: number }) {
  const deadline = Date.now() + opts.budgetMs;
  const minMembers = opts.minMembers ?? 10;
  const lastReflect = new Map<string, string>();
  for (const s of spaces) {
    const [last] = await b.vectors.query<EntryMeta>("memories", {
      filters: [{ op: "eq", path: "metadata.space", values: [s.key] }, { op: "eq", path: "metadata.op", values: ["reflect"] }],
      order: { field: "$id", dir: "desc" }, limit: 1, withVectors: false,
    }).catch(() => []);
    lastReflect.set(s.key, last?.metadata.createdAt ?? "");
  }
  const ordered = [...spaces].sort((x, y) => lastReflect.get(x.key)!.localeCompare(lastReflect.get(y.key)!));
  const results: ReflectRunResult[] = [];
  const errors: ReflectRunError[] = [];
  const skipped: string[] = [];
  for (const space of ordered) {
    if (Date.now() >= deadline) { skipped.push(space.key); continue; }
    const ctx: Ctx = { b, cfg: getConfig(), space, actor: "system:reflect", actorName: "reflect", scopes: ALL_SCOPES, defer: backgroundDefer };
    let targets: string[];
    try {
      targets = opts.concept ? [opts.concept] : (await b.vectors.query<ConceptMeta>("concepts", { filters: [{ op: "eq", path: "metadata.space", values: [space.key] }], limit: 200, withVectors: false }))
        .filter((x) => (x.metadata.membersN ?? 0) >= minMembers).map((x) => x.$id);
    } catch (e) {
      errors.push({ space: space.key, concept: null, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const id of targets) {
      if (Date.now() >= deadline) { if (!skipped.includes(space.key)) skipped.push(space.key); break; }
      try {
        const r = await reflect(ctx, id);
        if (!r.unchanged) results.push({ space: space.key, concept: id, seq: r.seq });
      } catch (e) {
        if (isEngramError(e) && (e.code === "bad_request" || e.code === "not_found")) continue;
        errors.push({ space: space.key, concept: id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return { results, errors, skipped };
}
