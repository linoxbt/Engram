import { agentNames, conceptMembers, labelConcept, toFeedItem } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";
import { limitSpaceWork } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const GET = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => {
  const docs = await conceptMembers(ctx, id);
  const names = await agentNames(ctx.b, docs.map((d) => d.metadata.agent), ctx.space);
  return { members: docs.map((d) => toFeedItem(d, names)) };
});
/** Re-label with the model now. */
export const POST = spaceRoute<{ key: string; id: string }>(async (ctx, access, _r, { id }) => {
  limitSpaceWork("concept", access.user.id, ctx.space.key);
  return labelConcept(ctx, id);
});
