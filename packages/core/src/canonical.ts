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
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  throw new Error(`unsupported type in hashed data: ${typeof v}`);
}
