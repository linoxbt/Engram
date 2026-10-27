/**
 * Canonical JSON: sorted keys, NFC strings, no numbers, no undefined values.
 * The single implementation used by the server, the Functions and the browser.
 */
export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v.normalize("NFC"));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" || typeof v === "bigint") throw new Error("numbers are not allowed in hashed data");
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Keys are normalised like values: hashing rests on one form, and leaving keys out of it was an asymmetry an
    // attacker could aim at. Two keys that collide once normalised would make the object ambiguous, so they throw.
    const pairs = Object.keys(o).filter((k) => o[k] !== undefined).map((k) => [k.normalize("NFC"), o[k]] as const);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (let i = 1; i < pairs.length; i++) if (pairs[i][0] === pairs[i - 1][0]) throw new Error(`two keys share the same canonical key: ${pairs[i][0]}`);
    return "{" + pairs.map(([k, val]) => JSON.stringify(k) + ":" + canonical(val)).join(",") + "}";
  }
  throw new Error(`unsupported type in hashed data: ${typeof v}`);
}
