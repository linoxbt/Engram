import { seqOf, type EntryMeta } from "@engram/core";
import { agentNames, resolveConflict } from "@engram/server";
import { readJson, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";

export const GET = spaceRoute(async (ctx) => {
  const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.status", values: ["active"] }, { op: "eq", path: "metadata.conflict", values: ["true"] }],
    order: { field: "$id", dir: "desc" }, limit: 200, withVectors: false,
  });
  const byId = new Map(docs.map((d) => [d.$id, d]));
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  const seen = new Set<string>();
  const pairs = [];
  for (const d of docs) for (const p of d.metadata.d.contradictedBy) {
    const key = [d.$id, p].sort().join("|");
    const o = byId.get(p);
    if (seen.has(key) || !o) continue;
    seen.add(key);
    const [a, b] = d.$id < p ? [d, o] : [o, d];
    const card = (x: typeof d) => ({
      id: x.$id, seq: seqOf(x.$id), text: x.metadata.c.text, agent: x.metadata.agent, agentName: names[x.metadata.agent] ?? x.metadata.agent,
      createdAt: x.metadata.createdAt, source: x.metadata.h.source, subject: x.metadata.subject, importance: Number(x.metadata.h.importance),
    });
    pairs.push({ a: card(a), b: card(b), reason: b.metadata.h.refs.contradicts.includes(a.$id) ? "Flagged by the contradiction engine when the newer memory arrived." : "Recorded as a conflict after the fact." });
  }
  return { pairs };
});

export const POST = spaceRoute(async (ctx, _a, req) => resolveConflict(ctx, await readJson(req)));
