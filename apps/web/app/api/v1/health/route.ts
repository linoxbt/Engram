import { getBackend, getConfig } from "@engram/server";
import { json } from "@/lib/server/api";
import { currentUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>) {
  const t = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) }; }
}

// Each run spends an embedding call, so results are shared for a minute; anonymous callers (uptime monitors)
// get only the verdict, not which services and keys are configured.
const TTL_MS = 60_000;
let cache: { at: number; status: number; body: Record<string, unknown> } | null = null;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  const user = await currentUser();
  // Signed-in people may force a re-run (the Status page), but not more than every 10 seconds.
  if (!cache || Date.now() - cache.at > TTL_MS || (fresh && user && Date.now() - cache.at > 10_000)) {
    const { status, body } = await run();
    cache = { at: Date.now(), status, body };
  }
  const body = user ? cache.body : { ok: cache.body.ok, ...(cache.body.error ? { error: "A dependency is unavailable." } : {}) };
  return json({ ...body, checkedAt: new Date(cache.at).toISOString() }, { status: cache.status, headers: { "Cache-Control": "no-store" } });
}

async function run(): Promise<{ status: number; body: Record<string, unknown> }> {
  const cfg = getConfig();
  let backendError: string | null = null;
  let b;
  try { b = getBackend(); } catch (e) { backendError = e instanceof Error ? e.message : String(e); }
  if (!b) return { status: 503, body: { ok: false, backend: cfg.backend, error: backendError } };
  const [database, embeddings, storage] = await Promise.all([
    check(() => b.vectors.query("memories", { limit: 1, withVectors: false })),
    check(() => b.embedder.embed(["health check"], "nomic-embed-text")),
    check(() => b.files.list(cfg.appwrite.checkpointsBucket, "cp_health_")),
  ]);
  const ok = database.ok && embeddings.ok && storage.ok;
  return {
    status: ok ? 200 : 503,
    body: {
      ok, backend: b.kind, database, embeddings, storage,
      signing: { checkpointFunction: !!cfg.appwrite.checkpointFunctionId, inlineKey: !!cfg.checkpoint.privateKey, publicKey: !!cfg.checkpoint.publicKey },
      classifier: cfg.classifierModel ?? "heuristic",
    },
  };
}
