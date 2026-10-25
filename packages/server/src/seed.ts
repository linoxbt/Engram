/**
 * Seeding: the demo story through the real write path, in chain order, with past timestamps. Resumable: with
 * a time budget it writes as much as fits, records where it stopped in the space settings, and the next call
 * continues, because a story takes minutes on a remote database and hosts cut requests off after seconds.
 */
import { createAgent, listAgents } from "./agents";
import { loadCheckpoints, runCheckpoint } from "./checkpoints";
import type { Ctx } from "./context";
import { embedDocuments } from "./embed";
import { EngramError, isEngramError } from "./errors";
import { forget } from "./forget";
import { remember } from "./remember";
import { DEMO_AGENTS, storyTimeline } from "./seed-data";
import { chainHead } from "./chain";
import type { SeedProgress } from "./settings";
import { getSpace, updateSettings } from "./spaces";

export interface SeedResult {
  entries: number;
  duplicates: number;
  /** Agent keys, returned once: by the call that created the agents. */
  keys: Record<string, string>;
  checkpoints: number;
  done: boolean;
  progress: { done: number; total: number };
}

export async function seedStory(ctx: Ctx, opts: { variant: "demo" | "sandbox"; background?: number; createdBy?: string; budgetMs?: number }): Promise<SeedResult> {
  const { b } = ctx;
  let space = (await getSpace(b, ctx.space.key)) ?? ctx.space;
  let p: SeedProgress | null = space.settings.seeding ?? null;
  const keys: Record<string, string> = {};

  if (!p) {
    if (await chainHead(b, space.key)) throw new EngramError("conflict", "Seed only into an empty space. Reset the sandbox first.");
    const existing = await listAgents(b, space.key);
    for (const a of DEMO_AGENTS) {
      if (existing.some((e) => e.name === a.name && e.status === "active")) continue;
      const res = await createAgent(b, space, { name: a.name, description: a.description, scopes: ["remember", "recall", "forget", "verify", "resolve"] }, opts.createdBy ?? "seed");
      keys[a.name] = res.key;
    }
    p = {
      variant: opts.variant, background: opts.background ?? null, next: 0, total: storyTimeline(opts.variant, opts.background).length,
      byKey: {}, entries: 0, duplicates: 0, createdBy: opts.createdBy ?? "seed",
    };
    await updateSettings(b, space.key, { seeding: p });
  }

  const items = storyTimeline(p.variant, p.background ?? undefined);
  const ids = Object.fromEntries((await listAgents(b, space.key)).filter((a) => a.status === "active").map((a) => [a.name, a.id]));
  const byKey = new Map(Object.entries(p.byKey));
  let { entries, duplicates, next } = p;
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;

  // Run post-commit work in order, so concepts and checkpoints are deterministic.
  const queue: (() => Promise<unknown>)[] = [];
  space = (await getSpace(b, space.key)) ?? space;
  const seedCtx: Ctx = { ...ctx, space, defer: (t) => queue.push(t) };
  const every = Math.max(1, space.settings.checkpointEvery);
  const key = ctx.cfg.checkpoint.privateKey;

  // Every call writes at least one item, so a slow backend can never stall the story.
  let wrote = 0;
  while (next < items.length && (wrote === 0 || Date.now() < deadline)) {
    const slice = items.slice(next, next + 8);
    const toEmbed = slice.filter((i) => !i.forget);
    const vectors = await embedDocuments(b, toEmbed.map((i) => i.text));
    const vecOf = new Map(toEmbed.map((it, i) => [it, vectors[i]]));
    for (const it of slice) {
      if (wrote > 0 && Date.now() >= deadline) break;
      const agent = ids[it.agent];
      const actorCtx: Ctx = { ...seedCtx, actor: agent, actorName: it.agent };
      if (it.forget) {
        const target = byKey.get(it.forget);
        if (target) {
          // A retried slice may find the memory already forgotten; that entry is already in the chain.
          await forget(actorCtx, { id: target, reason: it.text }, { createdAt: it.at }).catch((e) => { if (!(isEngramError(e) && e.code === "conflict")) throw e; });
          entries++;
        }
      } else {
        const relations = it.live ? undefined : [
          ...(it.supersedes ?? []).map((k) => ({ id: byKey.get(k)!, relation: "supersedes" as const, confidence: 1, reason: "Scripted in the demo story: a later change." })),
          ...(it.contradicts ?? []).map((k) => ({ id: byKey.get(k)!, relation: "contradicts" as const, confidence: 1, reason: "Scripted in the demo story: two agents disagree." })),
        ];
        const r = await remember(actorCtx, {
          text: it.text, kind: it.kind ?? "fact", subject: it.subject, importance: it.importance ?? 5, source: it.source,
        }, { createdAt: it.at, vector: vecOf.get(it), relations: relations?.length ? relations : undefined, skipRelate: !it.live && !relations?.length, agent, agentName: it.agent });
        if (r.status === "duplicate") duplicates++;
        else entries++;
        if (it.key && (r.status === "created" || !byKey.has(it.key))) byKey.set(it.key, r.id);
      }
      while (queue.length) {
        const task = queue.shift()!;
        await task().catch((e) => console.error("[engram] seed post-commit task failed", e));
      }
      if (key && entries % every === 0) await runCheckpoint(b, (await getSpace(b, space.key)) ?? space, { privateKey: key });
      next++;
      wrote++;
      p = { ...p, next, entries, duplicates, byKey: Object.fromEntries(byKey) };
      await updateSettings(b, space.key, { seeding: p });
    }
  }

  const done = next >= items.length;
  if (done) {
    if (key) await runCheckpoint(b, (await getSpace(b, space.key)) ?? space, { privateKey: key });
    await updateSettings(b, space.key, { seeding: null });
  }
  return { entries, duplicates, keys, checkpoints: done ? (await loadCheckpoints(b, space.key)).length : 0, done, progress: { done: next, total: items.length } };
}
