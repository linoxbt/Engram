import "server-only";
import { bearerMatches, EngramError, getConfig } from "@engram/server";

/** Netlify Scheduled Functions call these routes with `Authorization: Bearer $CRON_SECRET`. Without the secret they do not exist. */
export async function requireCron(req: Request) {
  const secret = getConfig().cronSecret;
  if (!secret) throw new EngramError("not_found", "Not found.");
  if (!(await bearerMatches(req.headers.get("authorization"), secret))) throw new EngramError("unauthorized", "Bad cron secret.");
}
