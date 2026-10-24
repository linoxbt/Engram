import "server-only";
import { timingSafeEqualHex } from "@engram/core";
import { EngramError, getConfig } from "@engram/server";

/** Netlify Scheduled Functions call these routes with `Authorization: Bearer $CRON_SECRET`. */
export function requireCron(req: Request) {
  const secret = getConfig().cronSecret;
  if (!secret) throw new EngramError("forbidden", "Set CRON_SECRET to enable cron routes.");
  if (!timingSafeEqualHex(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) throw new EngramError("unauthorized", "Bad cron secret.");
}
