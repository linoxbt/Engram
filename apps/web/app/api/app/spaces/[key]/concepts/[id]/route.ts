import { agentNames, conceptMembers, labelConcept, toFeedItem } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => {
  const docs = await conceptMembers(ctx, id);
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  return { members: docs.map((d) => toFeedItem(d, names)) };
});
/** Re-label with the model now. */
export const POST = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => labelConcept(ctx, id));
