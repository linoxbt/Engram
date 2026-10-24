import "server-only";
import { EngramError, getBackend, getSpace } from "@engram/server";

/** Public verification is opt-in per space. Text never leaves through these routes. */
export async function publicSpace(key: string) {
  const s = await getSpace(getBackend(), key);
  if (!s || !s.settings.publicVerify) throw new EngramError("not_found", "This space does not exist or has not switched on public verification.");
  return s;
}
