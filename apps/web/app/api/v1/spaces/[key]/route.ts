import { getConfig } from "@engram/server";
import { route } from "@/lib/server/api";
import { publicSpace } from "@/lib/server/public";

export const runtime = "nodejs";
export const GET = route<{ key: string }>(async (_req, { key }) => {
  const s = await publicSpace(key);
  return {
    key, name: s.settings.name, publicKey: getConfig().checkpoint.publicKey, keyId: getConfig().checkpoint.keyId,
    latestCheckpoint: s.settings.latestCheckpoint, integrity: s.settings.integrity, sandbox: s.settings.sandbox,
  };
});
