import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryId, generateKeyPair, iso } from "@engram/core";
import { createLocalBackend, createSpace, getConfig, resetConfig, setBackend, setConfig, updateSettings, type Backend } from "@engram/server";

const state = vi.hoisted(() => ({ user: null as null | { id: string }, classifier: vi.fn(), writtenAt: null as string | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
vi.mock("@/lib/server/api", () => ({
  json: (data: unknown, init?: ResponseInit) => Response.json(data, init),
  withRequestId: (run: (req: Request) => Promise<Response>) => run,
}));
vi.mock("@engram/server", async (orig) => {
  const real = await orig<typeof import("@engram/server")>();
  return {
    ...real,
    checkClassifier: state.classifier,
    // Freshness measures the real write time ($createdAt); the local backend always writes "now", so tests backdate it here.
    getEntry: async (...args: Parameters<typeof real.getEntry>) => {
      const d = await real.getEntry(...args);
      return d && state.writtenAt ? { ...d, $createdAt: state.writtenAt } : d;
    },
  };
});

async function route() {
  vi.resetModules();
  return import("../app/api/v1/health/route");
}
const get = async (url = "http://x/api/v1/health") => {
  const res = await (await route()).GET(new Request(url) as never);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

beforeEach(async () => {
  resetConfig();
  const keys = await generateKeyPair();
  setConfig({ backend: "local", classifierModel: null, checkpoint: { privateKey: keys.privateKey, publicKey: keys.publicKey, keyId: "test" } });
  setBackend(createLocalBackend({ dir: null }));
  state.user = null;
  state.writtenAt = null;
  state.classifier.mockReset().mockResolvedValue({ ok: true, ms: 5 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); resetConfig(); });

describe("health", () => {
  it("anonymous callers get only the verdict and never trigger the model check", async () => {
    setConfig({ classifierModel: "anthropic:claude-haiku-5-5" });
    const { status, body } = await get("http://x/api/v1/health?fresh=1");
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "ok", "status"]);
    expect(body).toMatchObject({ ok: true, status: "ok" });
    expect(state.classifier).not.toHaveBeenCalled();
  });

  it("signed-in callers get details and the model check, with provider errors made generic", async () => {
    state.user = { id: "u1" };
    setConfig({ classifierModel: "anthropic:claude-haiku-5-5" });
    state.classifier.mockResolvedValue({ ok: false, ms: 12, error: "401 invalid x-api-key sk-ant-api03-SECRETSECRET request id req_123" });
    const { body } = await get();
    expect(body.database).toMatchObject({ ok: true });
    expect(body.classifierCheck).toEqual({ ok: false, ms: 12, error: "The model provider rejected the API key.", code: "classifier_unavailable" });
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(state.classifier).toHaveBeenCalledTimes(1);
  });

  it("never returns raw dependency error messages", async () => {
    state.user = { id: "u1" };
    const b = createLocalBackend({ dir: null });
    setBackend({ ...b, vectors: { ...b.vectors, query: async () => { throw new Error("connect ECONNREFUSED 10.0.0.12:443 key=standard_abc"); } } } as Backend);
    const { status, body } = await get();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, status: "down" });
    expect(body.database).toMatchObject({ ok: false, error: "The memory database did not answer.", code: "internal" });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|standard_abc|10\.0\.0\.12/);
  });

  it("reports degraded when a space has waited too long for a checkpoint, and unknown Function state without the scope", async () => {
    state.user = { id: "u1" };
    setConfig({ appwrite: { ...getConfig().appwrite, endpoint: "https://appwrite.test/v1", projectId: "p", apiKey: "k", checkpointFunctionId: "checkpoint" } });
    const local = createLocalBackend({ dir: null });
    const b = { ...local, kind: "appwrite" } as Backend;
    setBackend(b);
    const space = await createSpace(b, { name: "S", ownerId: "" });
    const old = iso(Date.now() - 3 * 3600_000);
    state.writtenAt = old;
    for (let i = 0; i < 5; i++) await b.vectors.create("memories", entryId(space.key, i), { embeddings: [1, 0], metadata: { space: space.key, createdAt: old } }, []);
    await updateSettings(b, space.key, { latestCheckpoint: { fileId: "cp", seq: 1, size: 2, root: "r", createdAt: old }, integrity: { status: "valid", validThrough: 4, entries: 5, findings: 0, critical: 0, checkedAt: iso(), firstFinding: null } });
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, status: "degraded" });
    expect(body.freshness).toMatchObject({ status: "stale", spacesChecked: 1, checkpoints: { spacesBehind: 1, stale: 1, oldestUnsignedAt: old }, sentinel: { stale: 0 } });
    expect(body.freshness.functions.checkpoint.state).toBe("unknown");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/functions/checkpoint/executions");
    expect(JSON.stringify(body)).not.toContain(space.key);
  });

  it("reports a failing checkpoint Function from its latest executions", async () => {
    state.user = { id: "u1" };
    setConfig({ appwrite: { ...getConfig().appwrite, endpoint: "https://appwrite.test/v1", projectId: "p", apiKey: "k", checkpointFunctionId: "checkpoint" } });
    setBackend({ ...createLocalBackend({ dir: null }), kind: "appwrite" } as Backend);
    const now = iso();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/checkpoint/")
      ? { executions: [{ $createdAt: now, status: "failed" }, { $createdAt: now, status: "failed" }] }
      : { executions: [{ $createdAt: now, status: "completed", responseStatusCode: 200 }] })));
    const { body } = await get();
    expect(body.freshness.functions).toMatchObject({ checkpoint: { state: "failing" }, sentinel: { state: "ok" } });
    expect(body.status).toBe("degraded");
  });

  it("skips freshness on the local backend, which signs inline", async () => {
    state.user = { id: "u1" };
    const { body } = await get();
    expect(body.freshness).toMatchObject({ status: "skipped" });
    expect(body.status).toBe("ok");
  });
});
