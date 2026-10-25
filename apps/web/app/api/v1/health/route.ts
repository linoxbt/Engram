import { entryId, seqOf } from "@engram/core";
import { chainHead, checkClassifier, getBackend, getConfig, getEntry, isEngramError, listAllSpaces, type Backend, type EngramConfig } from "@engram/server";
import { json } from "@/lib/server/api";
import { currentUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health: dependencies (database, embeddings, storage), freshness of the background jobs (checkpoint signer,
 * sentinel) and, for signed-in callers, the classifier model.
 *
 * - Anonymous callers (uptime monitors) get only `{ ok, status }` from a result cached for 5 minutes, so a ping
 *   every minute costs at most one embedding call per 5 minutes and never a model call.
 * - Signed-in callers get the details, refreshed every minute; `?fresh` re-runs after 10 seconds. The model check
 *   runs only for signed-in callers and is cached for 10 minutes (or re-run by `?fresh`).
 * - Dependency errors are reported as a generic message and a code; the raw message goes to the server log only.
 *
 * status: "ok" | "degraded" (a background job is stale or failing: HTTP 200, ok false) | "down" (a dependency
 * failed: HTTP 503).
 */
const ANON_TTL_MS = 5 * 60_000;
const USER_TTL_MS = 60_000;
const FRESH_MIN_MS = 10_000;
const CLASSIFIER_TTL_MS = 10 * 60_000;
/** Generous on purpose: the Functions run every 5 and 15 minutes, but the Free plan stretches intervals to 60. */
const CHECKPOINT_STALE_MS = 70 * 60_000;
const SENTINEL_STALE_MS = 150 * 60_000;
const MAX_SPACES = 50;

type Check = { ok: boolean; ms: number; error?: string; code?: string };
type Core = { status: number; body: Record<string, unknown> };
let core: { at: number; value: Core } | null = null;
let classifier: { at: number; value: Check | null } | null = null;

const log = (what: string, e: unknown) => console.error(JSON.stringify({ level: "error", route: "/api/v1/health", check: what, message: e instanceof Error ? e.message : String(e) }));

/** Our own curated messages (e.g. "not provisioned yet") are safe to show; anything else becomes generic. */
function publicError(what: string, e: unknown, generic: string): { error: string; code: string } {
  log(what, e);
  if (isEngramError(e) && (e.code === "unavailable" || e.code === "embeddings_unavailable" || e.code === "rate_limited")) return { error: e.message, code: e.code };
  const code = isEngramError(e) ? e.code : e && typeof e === "object" && "type" in e && typeof (e as { type: unknown }).type === "string" && (e as { type: string }).type ? (e as { type: string }).type : "internal";
  return { error: generic, code };
}

async function check(what: string, generic: string, fn: () => Promise<unknown>): Promise<Check> {
  const t = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t }; }
  catch (e) { return { ok: false, ms: Date.now() - t, ...publicError(what, e, generic) }; }
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  // An auth outage must not take the health check down with it.
  const user = await currentUser().catch(() => null);
  const now = Date.now();
  const force = !!(fresh && user);
  const ttl = user ? USER_TTL_MS : ANON_TTL_MS;
  if (!core || now - core.at > ttl || (force && now - core.at > FRESH_MIN_MS)) core = { at: Date.now(), value: await runCore() };
  const { status, body } = core.value;

  if (!user) {
    return json({ ok: body.ok, status: body.status, checkedAt: new Date(core.at).toISOString() }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const cfg = getConfig();
  if (cfg.classifierModel && (!classifier || now - classifier.at > CLASSIFIER_TTL_MS || (force && now - classifier.at > FRESH_MIN_MS))) {
    classifier = { at: Date.now(), value: await runClassifier(cfg) };
  }
  return json({
    ...body,
    classifier: cfg.classifierModel ?? "heuristic",
    classifierCheck: cfg.classifierModel ? classifier?.value ?? null : null,
    checkedAt: new Date(core.at).toISOString(),
  }, { status, headers: { "Cache-Control": "no-store" } });
}

async function runClassifier(cfg: EngramConfig): Promise<Check | null> {
  const r = await checkClassifier(cfg);
  if (!r || r.ok) return r;
  log("classifier", r.error);
  const m = r.error ?? "";
  // Curated hints only; the provider's raw text stays in the log.
  const error = /workspace/i.test(m) ? "The model provider requires a workspace: set ANTHROPIC_WORKSPACE_ID."
    : /api key|x-api-key|unauthori[sz]ed|authentication|401/i.test(m) ? "The model provider rejected the API key."
    : /rate|429|overloaded|529/i.test(m) ? "The model provider is rate limiting or overloaded."
    : /no api key/i.test(m) ? "No API key for this model. Set MODEL_API_KEY."
    : "The model provider did not answer.";
  return { ok: false, ms: r.ms, error, code: "classifier_unavailable" };
}

async function runCore(): Promise<Core> {
  const cfg = getConfig();
  let b: Backend | undefined;
  try { b = getBackend(); } catch (e) {
    const { error, code } = publicError("backend", e, "The storage backend is not configured.");
    return { status: 503, body: { ok: false, status: "down", backend: cfg.backend, error, code } };
  }
  const [database, embeddings, storage] = await Promise.all([
    check("database", "The memory database did not answer.", () => b.vectors.query("memories", { limit: 1, withVectors: false })),
    check("embeddings", "The embeddings service did not answer.", () => b.embedder.embed(["health check"], "nomic-embed-text")),
    check("storage", "File storage did not answer.", () => b.files.list(cfg.appwrite.checkpointsBucket, "cp_health_")),
  ]);
  const depsOk = database.ok && embeddings.ok && storage.ok;
  const freshness = depsOk ? await runFreshness(b, cfg).catch((e) => ({ status: "unknown", ...publicError("freshness", e, "Freshness could not be checked.") })) : { status: "unknown", reason: "dependencies down" };
  const degraded = (freshness as { status: string }).status === "stale";
  const status = !depsOk ? "down" : degraded ? "degraded" : "ok";
  return {
    status: depsOk ? 200 : 503,
    body: {
      ok: status === "ok", status, backend: b.kind, database, embeddings, storage, freshness,
      signing: { checkpointFunction: !!cfg.appwrite.checkpointFunctionId, inlineKey: !!cfg.checkpoint.privateKey, publicKey: !!cfg.checkpoint.publicKey },
    },
  };
}

type Execution = { $createdAt: string; status: string; responseStatusCode?: number; trigger?: string };
type FunctionState = { state: "ok" | "failing" | "stale" | "never" | "not_deployed" | "unknown"; lastAt?: string; lastStatus?: string; reason?: string };

/** Latest executions through the Functions REST API. Without the executions.read scope this is "unknown", never an error. */
async function functionState(cfg: EngramConfig, functionId: string, staleMs: number): Promise<FunctionState> {
  const { endpoint, projectId, apiKey } = cfg.appwrite;
  const q = (o: object) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`;
  try {
    const res = await fetch(`${endpoint}/functions/${encodeURIComponent(functionId)}/executions?${q({ method: "limit", values: [3] })}&${q({ method: "orderDesc", attribute: "$createdAt" })}`, {
      headers: { "X-Appwrite-Project": projectId, "X-Appwrite-Key": apiKey }, signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { state: "unknown", reason: "the server key lacks the executions.read scope" };
    if (res.status === 404) return { state: "not_deployed" };
    if (!res.ok) { log(`executions:${functionId}`, `HTTP ${res.status}`); return { state: "unknown", reason: `HTTP ${res.status}` }; }
    const list = ((await res.json()) as { executions?: Execution[] }).executions ?? [];
    const last = list[0];
    if (!last) return { state: "never" };
    const failing = list.length > 0 && list.every((e) => e.status === "failed" || (e.responseStatusCode ?? 200) >= 500);
    const stale = Date.now() - Date.parse(last.$createdAt) > staleMs;
    return { state: failing ? "failing" : stale ? "stale" : "ok", lastAt: last.$createdAt, lastStatus: last.status };
  } catch (e) {
    log(`executions:${functionId}`, e);
    return { state: "unknown", reason: "the Functions API did not answer" };
  }
}

/**
 * Background jobs: a space with entries written since its latest checkpoint must not wait longer than
 * CHECKPOINT_STALE_MS for a signature, and the sentinel must have re-verified every space within SENTINEL_STALE_MS.
 * Only counts are returned: space keys belong to their members.
 */
async function runFreshness(b: Backend, cfg: EngramConfig) {
  if (b.kind !== "appwrite") return { status: "skipped", reason: "the local backend signs checkpoints inline" };
  const now = Date.now();
  const spaces = (await listAllSpaces(b)).slice(0, MAX_SPACES);
  let behind = 0, staleCheckpoints = 0, staleSentinel = 0, neverChecked = 0;
  let oldestUncovered = null as string | null, oldestCheck = null as string | null;
  await Promise.all(spaces.map(async (s) => {
    const head = await chainHead(b, s.key);
    const size = head ? seqOf(head.$id) + 1 : 0;
    const covered = s.settings.latestCheckpoint?.size ?? 0;
    if (size > covered) {
      behind++;
      const first = await getEntry(b, entryId(s.key, covered));
      const at = first?.metadata.createdAt ?? head?.metadata.createdAt ?? null;
      if (at && (!oldestUncovered || at < oldestUncovered)) oldestUncovered = at;
      if (at && cfg.appwrite.checkpointFunctionId && now - Date.parse(at) > CHECKPOINT_STALE_MS) staleCheckpoints++;
    }
    if (size > 0) {
      const checked = s.settings.integrity?.checkedAt ?? null;
      if (!checked) neverChecked++;
      else if (!oldestCheck || checked < oldestCheck) oldestCheck = checked;
      const since = checked ? Date.parse(checked) : Date.parse(s.settings.createdAt || new Date(now).toISOString());
      if (now - since > SENTINEL_STALE_MS) staleSentinel++;
    }
  }));
  const [checkpointFn, sentinelFn] = await Promise.all([
    cfg.appwrite.checkpointFunctionId ? functionState(cfg, cfg.appwrite.checkpointFunctionId, CHECKPOINT_STALE_MS) : Promise.resolve<FunctionState>({ state: "not_deployed", reason: "CHECKPOINT_FUNCTION_ID is not set; checkpoints are signed inline" }),
    functionState(cfg, "sentinel", SENTINEL_STALE_MS),
  ]);
  const fnBad = (f: FunctionState) => f.state === "failing" || f.state === "stale";
  const stale = staleCheckpoints > 0 || staleSentinel > 0 || fnBad(checkpointFn) || (sentinelFn.state !== "not_deployed" && fnBad(sentinelFn));
  return {
    status: stale ? "stale" : "fresh",
    spacesChecked: spaces.length,
    checkpoints: { spacesBehind: behind, stale: staleCheckpoints, oldestUnsignedAt: oldestUncovered, thresholdMinutes: CHECKPOINT_STALE_MS / 60_000 },
    sentinel: { stale: staleSentinel, neverChecked, oldestCheckedAt: oldestCheck, thresholdMinutes: SENTINEL_STALE_MS / 60_000 },
    functions: { checkpoint: checkpointFn, sentinel: sentinelFn },
  };
}
