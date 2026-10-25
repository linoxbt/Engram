/** Only a same-origin path: starts with one "/" and is not "//host" or "/\host" (both read as another site). */
const isLocalPath = (p: string) => /^\/(?![/\\])/.test(p) && !/[\u0000-\u001f\u007f]/.test(p);

/**
 * A post-sign-in destination against `origin`. The input and the normalised OUTPUT are both checked: URL
 * normalisation turns `/.//evil.com`, `/a/..//evil.com` or `/%2e//evil.com` into `//evil.com`, which the router
 * would treat as an external address.
 */
export function safeNextFor(next: string | null | undefined, origin: string, fallback = "/app"): string {
  if (!next || !isLocalPath(next)) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return fallback;
    const out = `${url.pathname}${url.search}${url.hash}`;
    return isLocalPath(out) ? out : fallback;
  } catch { return fallback; }
}

/** Browser wrapper: the current page's origin. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (typeof window === "undefined") return fallback;
  return safeNextFor(next, window.location.origin, fallback);
}
