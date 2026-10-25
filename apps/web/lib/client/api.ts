"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Reads a JSON body; anything else (an HTML error page from a proxy, a cut-off body) becomes an ApiError. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const unexpected = () => new ApiError(res.status, "bad_response", `The server returned an unexpected response (${res.status}). Try again.`);
  const text = await res.text().catch(() => { throw unexpected(); });
  if (!text) return null as T;
  if (!/json/i.test(res.headers.get("content-type") ?? "")) throw unexpected();
  try { return JSON.parse(text) as T; } catch { throw unexpected(); }
}

/** Like readJson, but a non-2xx status throws an ApiError carrying the server's error code and message. */
export async function readOk<T = unknown>(res: Response): Promise<T> {
  const data = await readJson<{ error?: { code?: string; message?: string } } | null>(res);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 401 && typeof window !== "undefined" && path.startsWith("/api/app")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  try {
    return await readOk<T>(res);
  } catch (e) {
    // An account that never accepted the Terms (made directly against Appwrite) is sent to accept them first.
    if (e instanceof ApiError && e.code === "terms_required" && typeof window !== "undefined" && window.location.pathname !== "/accept-terms") {
      window.location.href = `/accept-terms?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw e;
  }
}
