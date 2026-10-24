import { getBackend, proofFor } from "@engram/server";
import { route } from "@/lib/server/api";
import { publicSpace } from "@/lib/server/public";

export const runtime = "nodejs";
/** Public inclusion proof: hashes only, never text. */
export const GET = route<{ key: string; id: string }>(async (_req, { key, id }) => proofFor(getBackend(), await publicSpace(key), id));
