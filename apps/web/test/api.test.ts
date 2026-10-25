import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, isReadOnly } from "@/lib/client/api";

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => { vi.unstubAllGlobals(); });

describe("api client", () => {
  it("sends an account that has not accepted the terms to the accept-terms screen, keeping where it was", async () => {
    const location = { pathname: "/app/k7m2q9xa/memories", search: "?q=1", href: "" };
    vi.stubGlobal("window", { location });
    vi.stubGlobal("fetch", async () => respond(403, { error: { code: "terms_required", message: "Accept the terms" } }));
    await expect(api("/api/app/spaces")).rejects.toBeInstanceOf(ApiError);
    expect(location.href).toBe(`/accept-terms?next=${encodeURIComponent("/app/k7m2q9xa/memories?q=1")}`);
  });

  it("does not loop on the accept-terms screen itself", async () => {
    const location = { pathname: "/accept-terms", search: "", href: "" };
    vi.stubGlobal("window", { location });
    vi.stubGlobal("fetch", async () => respond(403, { error: { code: "terms_required", message: "x" } }));
    await expect(api("/api/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(location.href).toBe("");
  });

  it("recognises a read-only refusal", async () => {
    vi.stubGlobal("window", { location: { pathname: "/app/x", search: "", href: "" } });
    vi.stubGlobal("fetch", async () => respond(403, { error: { code: "read_only", message: "This demo is read-only." } }));
    const e = (await api("/api/app/spaces/x/memories", { method: "POST", json: {} }).catch((x: unknown) => x)) as ApiError;
    expect(isReadOnly(e)).toBe(true);
    expect(e.message).toBe("This demo is read-only.");
  });
});
