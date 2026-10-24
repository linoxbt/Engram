/** Seeding: the demo story through the real write path, in chain order, with past timestamps. */
import { createAgent, listAgents } from "./agents";
import { runCheckpoint } from "./checkpoints";
import type { Ctx } from "./context";
import { embedDocuments } from "./embed";
import { EngramError } from "./errors";
import { forget } from "./forget";
import { remember } from "./remember";
import { DEMO_AGENTS, storyTimeline } from "./seed-data";
import { chainHead } from "./chain";
import { getSpace } from "./spaces";

export interface SeedResult { entries: number; duplicates: number; keys: Record<string, string>; checkpoints: number }

export async function seedStory(ctx: Ctx, opts: { variant: "demo" | "sandbox"; background?: number; createdBy?: string }): Promise<SeedResult> {
  const { b, space } = ctx;
  if (await chainHead(b, space.key)) throw new EngramError("conflict", "Seed only into an empty space. Reset the sandbox first.");

  const existing = await listAgents(b, space.key);
  const ids: Record<string, string> = {};
  const keys: Record<string, string> = {};
  for (const a of DEMO_AGENTS) {
    const found = existing.find((e) => e.name === a.name && e.status === "active");
    if (found) { ids[a.name] = found.id; continue; }
    const res = await createAgent(b, space, { name: a.name, description: a.description, scopes: ["remember", "recall", "forget", "verify", "resolve"] }, opts.createdBy ?? "seed");
    ids[a.name] = res.agent.id;
    keys[a.name] = res.key;
  }

  const items = storyTimeline(opts.variant, opts.background);
  const toEmbed = items.filter((i) => !i.forget);
  const vectors = await embedDocuments(b, toEmbed.map((i) => i.text));
  const vecOf = new Map(toEmbed.map((it, i) => [it, vectors[i]]));

  // Run post-commit work in order, so concepts and checkpoints are deterministic.
  const queue: (() => Promise<unknown>)[] = [];
  const seedCtx: Ctx = { ...ctx, defer: (t) => queue.push(t) };
  const byKey = new Map<string, string>();
  let entries = 0, duplicates = 0, checkpoints = 0;
  const every = Math.max(1, space.settings.checkpointEvery);
  const key = ctx.cfg.checkpoint.privateKey;

  for (const it of items) {
    const agent = ids[it.agent];
    const actorCtx: Ctx = { ...seedCtx, actor: agent, actorName: it.agent };
    if (it.forget) {
      const target = byKey.get(it.forget);
      if (!target) continue;
      await forget(actorCtx, { id: target, reason: it.text }, { createdAt: it.at });
      entries++;
    } else {
      const relations = it.live ? undefined : [
        ...(it.supersedes ?? []).map((k) => ({ id: byKey.get(k)!, relation: "supersedes" as const, confidence: 1, reason: "Scripted in the demo story: a later change." })),
        ...(it.contradicts ?? []).map((k) => ({ id: byKey.get(k)!, relation: "contradicts" as const, confidence: 1, reason: "Scripted in the demo story: two agents disagree." })),
      ];
      const r = await remember(actorCtx, {
        text: it.text, kind: it.kind ?? "fact", subject: it.subject, importance: it.importance ?? 5, source: it.source,
      }, { createdAt: it.at, vector: vecOf.get(it), relations: relations?.length ? relations : undefined, skipRelate: !it.live && !relations?.length, agent, agentName: it.agent });
      if (r.status === "duplicate") duplicates++;
      else { entries++; if (it.key) byKey.set(it.key, r.id); }
    }
    while (queue.length) {
      const task = queue.shift()!;
      // Checkpoints are signed explicitly below; skip the per-write trigger during seeding.
      await task().catch((e) => console.error("[engram] seed post-commit task failed", e));
    }
    if (key && entries % every === 0) {
      const fresh = (await getSpace(b, space.key)) ?? space;
      const run = await runCheckpoint(b, fresh, { privateKey: key });
      if (run.created) checkpoints++;
    }
  }
  if (key) {
    const fresh = (await getSpace(b, space.key)) ?? space;
    const run = await runCheckpoint(b, fresh, { privateKey: key });
    if (run.created) checkpoints++;
  }
  return { entries, duplicates, keys, checkpoints };
}
