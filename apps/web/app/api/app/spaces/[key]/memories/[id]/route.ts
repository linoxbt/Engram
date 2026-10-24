import { spaceRoute } from "@/lib/server/api";
import { memoryDetail } from "@/lib/server/detail";

export const runtime = "nodejs";
export const GET = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => memoryDetail(ctx, id));
