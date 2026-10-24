import { SettingsInput, updateSettings } from "@engram/server";
import { readJson, requireOwner, spaceRoute } from "@/lib/server/api";

export const runtime = "nodejs";
export const PATCH = spaceRoute(async (ctx, access, req) => {
  requireOwner(access);
  const patch = SettingsInput.parse(await readJson(req));
  const { people: _p, ...settings } = await updateSettings(ctx.b, ctx.space.key, patch);
  return { settings };
});
