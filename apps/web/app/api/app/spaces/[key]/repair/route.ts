import { repairSpace } from "@engram/server";
import { requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = spaceRoute(async (ctx, access) => { requireOwner(access); return repairSpace(ctx); });
