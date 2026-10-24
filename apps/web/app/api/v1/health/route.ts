import { getBackend, getConfig } from "@engram/server";
import { json } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>) {
  const t = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) }; }
}

export async function GET() {
  const cfg = getConfig();
  let backendError: string | null = null;
  let b;
  try { b = getBackend(); } catch (e) { backendError = e instanceof Error ? e.message : String(e); }
  if (!b) return json({ ok: false, backend: cfg.backend, error: backendError }, { status: 503 });
  const [database, embeddings, storage] = await Promise.all([
    check(() => b.vectors.query("memories", { limit: 1, withVectors: false })),
    check(() => b.embedder.embed(["health check"], "nomic-embed-text")),
    check(() => b.files.list(cfg.appwrite.checkpointsBucket, "cp_health_")),
  ]);
  const ok = database.ok && embeddings.ok && storage.ok;
  return json({
    ok, backend: b.kind, database, embeddings, storage,
    signing: { checkpointFunction: !!cfg.appwrite.checkpointFunctionId, inlineKey: !!cfg.checkpoint.privateKey, publicKey: !!cfg.checkpoint.publicKey },
    classifier: cfg.classifierModel ?? "heuristic",
  }, { status: ok ? 200 : 503 });
}
