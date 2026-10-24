import { repairSpace } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 120;
export const POST = spaceRoute(async (ctx, access) => { requireOwner(access); return repairSpace(ctx); });
