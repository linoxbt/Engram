import type { Config } from "@netlify/functions";

/** Every 15 minutes (UTC): re-verify every space and refresh its integrity badge. */
export default async () => {
  const base = Netlify.env.get("URL");
  const secret = Netlify.env.get("CRON_SECRET");
  if (!base || !secret) return console.warn("sentinel: URL or CRON_SECRET missing");
  const res = await fetch(`${base}/api/cron/sentinel`, { headers: { authorization: `Bearer ${secret}` } });
  console.log("sentinel", res.status, (await res.text()).slice(0, 500));
};

export const config: Config = { schedule: "*/15 * * * *" };
