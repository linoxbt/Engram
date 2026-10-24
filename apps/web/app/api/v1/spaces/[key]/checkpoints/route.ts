import { getBackend, loadCheckpoints } from "@engram/server";
import { route } from "@/lib/server/api";
import { publicSpace } from "@/lib/server/public";

export const runtime = "nodejs";
export const GET = route<{ key: string }>(async (_req, { key }) => {
  await publicSpace(key);
  return { checkpoints: await loadCheckpoints(getBackend(), key) };
});
