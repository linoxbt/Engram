/** A post-sign-in destination: only same-origin relative paths, so `//evil.com` or `/\evil.com` fall back. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !/^\/(?![/\\])/.test(next) || typeof window === "undefined") return fallback;
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}
