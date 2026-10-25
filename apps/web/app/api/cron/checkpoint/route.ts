import { getBackend, getConfig, listAllSpaces, runCheckpoint, EngramError } from "@engram/server";
import { route } from "@/lib/server/api";
import { requireCron } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Fallback scheduler for deployments without the Appwrite checkpoint Function. */
export const GET = route(async (req) => {
  await requireCron(req);
  const key = getConfig().checkpoint.privateKey;
  if (!key) throw new EngramError("unavailable", "CP_PRIVATE_KEY is not set in this deployment; the checkpoint Function signs instead.");
  const b = getBackend();
  const out = [];
  for (const s of await listAllSpaces(b)) {
    try { const r = await runCheckpoint(b, s, { privateKey: key }); out.push({ space: s.key, created: r.created, reason: r.reason ?? null }); }
    catch (e) { out.push({ space: s.key, created: false, reason: e instanceof Error ? e.message : String(e) }); }
  }
  return { ran: out.length, results: out };
});
