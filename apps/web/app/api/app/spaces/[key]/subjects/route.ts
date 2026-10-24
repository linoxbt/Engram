import { loadChain } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute(async (ctx) => {
  const chain = await loadChain(ctx.b, ctx.space.key);
  const counts = new Map<string, number>();
  for (const e of chain) if (e.metadata.subject) counts.set(e.metadata.subject, (counts.get(e.metadata.subject) ?? 0) + 1);
  return {
    subjects: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([subject, count]) => ({ subject, count })),
    span: chain.length ? { first: chain[0].metadata.createdAt, last: chain[chain.length - 1].metadata.createdAt } : null,
    ticks: chain.map((e) => ({ seq: Number(e.metadata.seq), op: e.metadata.op, at: e.metadata.createdAt, superseding: e.metadata.h.refs.supersedes.length > 0, subject: e.metadata.subject })),
  };
});
