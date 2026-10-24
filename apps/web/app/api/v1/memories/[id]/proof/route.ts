import { proofFor } from "@engram/server";
import { agentRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const GET = agentRoute<{ id: string }>("verify", async (ctx, _req, { id }) => proofFor(ctx.b, ctx.space, id));
