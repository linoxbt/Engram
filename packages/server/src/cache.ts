/**
 * A tiny LRU for per-process memoisation. Bounded by the WEIGHT of what is kept — leaf hashes, index rows, files —
 * and not by the number of spaces: one busy space with a long chain could otherwise hold megabytes under a single
 * key and a cap of "16 spaces" would never notice. A Map keeps insertion order, so re-inserting on a hit moves a
 * key to the back and the first key is always the least recently used.
 */
export class LruCache<V> {
  private m = new Map<string, V>();
  private used = 0;
  constructor(private max: number, private weigh: (v: V) => number = () => 1) {}

  get(key: string): V | undefined {
    const v = this.m.get(key);
    if (v === undefined) return undefined;
    this.m.delete(key);
    this.m.set(key, v);
    return v;
  }

  set(key: string, value: V) {
    this.delete(key);
    this.m.set(key, value);
    this.used += this.weigh(value);
    // One value heavier than the whole budget is still kept: evicting what was just asked for helps nobody.
    for (const [k, v] of this.m) {
      if (this.used <= this.max || this.m.size <= 1) break;
      this.m.delete(k);
      this.used -= this.weigh(v);
    }
  }

  delete(key: string) {
    const v = this.m.get(key);
    if (v === undefined) return;
    this.m.delete(key);
    this.used -= this.weigh(v);
  }

  /** How many keys are held, and how much they weigh: for tests and diagnostics. */
  get size() { return this.m.size; }
  get weight() { return this.used; }
}
