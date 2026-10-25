import { getBackend, runSentinel } from "@engram/server";
import { route } from "@/lib/server/api";
import { requireCron } from "@/lib/server/cron";

export const runtime = "nodejs";
export const GET = route(async (req) => {
  await requireCron(req);
  return runSentinel(getBackend());
});
