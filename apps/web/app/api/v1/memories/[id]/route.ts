import { agentRoute } from "@/lib/server/api";
import { memoryDetail } from "@/lib/server/detail";

export const runtime = "nodejs";
export const GET = agentRoute<{ id: string }>("recall", async (ctx, _req, { id }) => memoryDetail(ctx, id));
