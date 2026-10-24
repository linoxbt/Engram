import { getBackend, runSentinel } from "@engram/server";
import { route } from "@/lib/server/api";
import { requireCron } from "@/lib/server/cron";

export const runtime = "nodejs";
export const maxDuration = 300;
export const GET = route(async (req) => {
  requireCron(req);
  return { results: await runSentinel(getBackend()) };
});
