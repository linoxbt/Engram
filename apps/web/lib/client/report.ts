"use client";

const seen = new Set<string>();

/** Send one browser error to the server, once per message per page load. Never throws. */
export function reportError(kind: "error" | "unhandledrejection" | "boundary", error: unknown, digest?: string) {
  try {
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const key = `${kind}:${e.message}`;
    if (seen.has(key) || seen.size > 20) return;
    seen.add(key);
    const body = JSON.stringify({ kind, message: e.message.slice(0, 1000), stack: e.stack?.slice(0, 4000), url: location.pathname.slice(0, 500), digest });
    if (!navigator.sendBeacon?.("/api/telemetry/error", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/telemetry/error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* reporting must never break the page */ }
}
