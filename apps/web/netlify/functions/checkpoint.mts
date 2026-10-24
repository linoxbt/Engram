import type { Config } from "@netlify/functions";

/**
 * Every 5 minutes (UTC): sign checkpoints for spaces that grew. Used when the
 * Appwrite checkpoint Function is not deployed; the app route signs with
 * CP_PRIVATE_KEY.
 */
export default async () => {
  const base = Netlify.env.get("URL");
  const secret = Netlify.env.get("CRON_SECRET");
  if (!base || !secret) return console.warn("checkpoint: URL or CRON_SECRET missing");
  const res = await fetch(`${base}/api/cron/checkpoint`, { headers: { authorization: `Bearer ${secret}` } });
  console.log("checkpoint", res.status, (await res.text()).slice(0, 500));
};

export const config: Config = { schedule: "*/5 * * * *" };
