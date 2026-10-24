import { reflect } from "@engram/server";
import { spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = spaceRoute<{ key: string; id: string }>(async (ctx, _a, _r, { id }) => reflect(ctx, id));
