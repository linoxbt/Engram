import { EngramError, SettingsInput, updateSettings } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";
import { cleanDisplayName } from "@/lib/server/names";

export const runtime = "nodejs";
export const PATCH = spaceRoute(async (ctx, access, req) => {
  requireOwner(access);
  const patch = SettingsInput.parse(await readJson(req));
  // A rename reaches the same email subjects and logs as creation: one plain line (see POST /api/app/spaces).
  if (patch.name !== undefined) patch.name = cleanDisplayName(patch.name, 64);
  if (patch.description !== undefined) patch.description = cleanDisplayName(patch.description, 300);
  if (patch.name !== undefined && patch.name.length < 2) throw new EngramError("bad_request", "A name needs at least 2 characters.");
  if (patch.classifierModel && !ctx.cfg.allowedModels.includes(patch.classifierModel)) {
    throw new EngramError("bad_request", ctx.cfg.allowedModels.length ? `Choose one of: ${ctx.cfg.allowedModels.join(", ")}.` : "Model classification is not enabled on this server.");
  }
  const { people: _p, ...settings } = await updateSettings(ctx.b, ctx.space.key, patch);
  return { settings };
});
