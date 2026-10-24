import { EngramError, SettingsInput, updateSettings } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const PATCH = spaceRoute(async (ctx, access, req) => {
  requireOwner(access);
  const patch = SettingsInput.parse(await readJson(req));
  if (patch.classifierModel && !ctx.cfg.allowedModels.includes(patch.classifierModel)) {
    throw new EngramError("bad_request", ctx.cfg.allowedModels.length ? `Choose one of: ${ctx.cfg.allowedModels.join(", ")}.` : "Model classification is not enabled on this server.");
  }
  const { people: _p, ...settings } = await updateSettings(ctx.b, ctx.space.key, patch);
  return { settings };
});
