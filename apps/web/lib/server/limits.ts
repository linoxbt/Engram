/** Pure pieces of the per-instance rate limiter (no Next.js imports, so they are unit-testable). */

/**
 * The key a client is limited by: an IPv4 address as is, an IPv6 address by its /64 (one household or server gets
 * a whole /64, so per-address limits would be trivial to dodge), "unknown" when there is no usable address.
 */
export function clientKey(raw: string | null | undefined): string {
  let ip = (raw ?? "").trim();
  if (!ip || ip === "unknown") return "unknown";
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) ip = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  ip = ip.replace(/%.*$/, "").toLowerCase();
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").every((o) => Number(o) <= 255) ? ip : "unknown";
  if (!/^[0-9a-f:.]+$/.test(ip) || !ip.includes(":")) return "unknown";
  const groups = expandV6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : "unknown";
}

function expandV6(ip: string): string[] | null {
  // An embedded IPv4 tail counts as two groups.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    if (o.some((x) => x > 255)) return null;
    ip = ip.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => g.replace(/^0+(?=.)/, ""));
}

/**
 * The address a request is limited by. In production only the platform's own client-IP header counts: Netlify
 * sets `x-nf-client-connection-ip` at its edge and overwrites whatever the caller sent, while `x-real-ip` is not
 * a header Netlify sets at all and `x-forwarded-for` is partly the caller's own text — trusting either would let
 * one line of headers give every request a fresh address and void every IP-keyed limit here. Outside production
 * those two are a convenience for proxies in front of `next dev`. A request with no usable address shares the
 * single strict "unknown" bucket rather than going unlimited.
 */
export function clientIpFrom(headers: Headers, prod: boolean): string {
  const platform = headers.get("x-nf-client-connection-ip");
  if (prod || platform) return clientKey(platform);
  return clientKey(headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",").pop()?.trim());
}

/**
 * Per-person, per-space budgets for the costly work a MEMBER can start. The engine's own limiter only guards
 * agent keys (`enforceRate` skips `user:` actors), so without these a signed-in member of any space could spend
 * the model budget, or rebuild and sign the whole Merkle tree, in a loop. Generous enough that nobody working by
 * hand reaches one.
 */
export const SPACE_WORK_LIMITS = {
  remember: { max: 240, message: "Too many memories written to this space." },
  concept: { max: 60, message: "Too many concept labels requested." },
  reflect: { max: 30, message: "Too many reflections requested." },
  checkpoint: { max: 20, message: "Too many checkpoints sealed for this space." },
  conflict: { max: 120, message: "Too many conflict decisions." },
  forget: { max: 120, message: "Too many memories forgotten." },
} as const;

/**
 * Fixed-window counters in least-recently-used order. When full, expired windows go first, then the entries
 * touched longest ago: never everything at once, so flooding it with fresh keys cannot wipe an attacker's own
 * counter while they keep using it.
 */
export class WindowCounter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private sweptAt = 0;
  constructor(private maxKeys = 50_000) {}
  get size() { return this.windows.size; }

  /** Counts one hit; returns ms until the window resets when this hit is over `max`, else null. */
  hit(id: string, max: number, windowMs: number, now = Date.now()): number | null {
    if (now - this.sweptAt > 60_000) { this.sweep(now); this.sweptAt = now; }
    let w = this.windows.get(id);
    if (w) this.windows.delete(id); // re-inserted below: most recently used last
    if (!w || w.resetAt <= now) w = { count: 0, resetAt: now + windowMs };
    w.count++;
    this.windows.set(id, w);
    if (this.windows.size > this.maxKeys) this.evict(now);
    return w.count > max ? w.resetAt - now : null;
  }

  /**
   * A per-key budget inside a shared cap: true while `key` is under `perKey` AND everyone together is under
   * `total`. A key that is over its own budget does not spend the shared one.
   */
  allow(bucket: string, key: string, perKey: number, total: number, windowMs: number, now = Date.now()): boolean {
    if (this.hit(`${bucket}:key:${key}`, perKey, windowMs, now) !== null) return false;
    return this.hit(`${bucket}:all`, total, windowMs, now) === null;
  }

  private sweep(now: number) { for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k); }

  private evict(now: number) {
    this.sweep(now);
    for (const k of this.windows.keys()) {
      if (this.windows.size <= this.maxKeys) break;
      this.windows.delete(k);
    }
  }
}
