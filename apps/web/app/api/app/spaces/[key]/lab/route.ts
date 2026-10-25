import { z } from "zod";
import { ATTACKS } from "@engram/core";
import { attack, resetSandbox, sealSandbox, requireSandbox } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  action: z.enum(["attack", "reset", "seal"]),
  attack: z.enum(ATTACKS.map((a) => a.id) as [string, ...string[]]).optional(),
  params: z.object({ seq: z.number().int().min(0).optional(), otherSeq: z.number().int().min(0).optional(), text: z.string().max(500).optional() }).default({}),
});

export const GET = spaceRoute(async (ctx) => { requireSandbox(ctx); return { attacks: ATTACKS }; });
export const POST = spaceRoute(async (ctx, access, req) => {
  const body = Body.parse(await readJson(req));
  // The same rule as continuing the story (/seed): a reset someone else cannot finish would leave it half-seeded.
  if (body.action === "reset") { requireOwner(access); return resetSandbox(ctx, `user:${access.user.id}`, 6_000); }
  if (body.action === "seal") return sealSandbox(ctx);
  return attack(ctx, body.attack as Parameters<typeof attack>[1], body.params);
});
