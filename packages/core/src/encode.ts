/** Fixed-width string encodings. Fixed width makes lexical order equal numeric order. */

export const pad = (n: number, w: number) => String(Math.trunc(n)).padStart(w, "0");
export const seqStr = (n: number) => pad(n, 12);
export const count8 = (n: number) => pad(Math.max(0, n), 8);
export const score = (n: number) => pad(Math.max(0, Math.min(10, Math.round(n))), 2);
/** ISO-8601 UTC with milliseconds: always 24 characters for years 1000-9999. */
export const iso = (d: Date | number | string = Date.now()) => new Date(d).toISOString();

export const SPACE_KEY_RE = /^[a-z0-9]{8}$/;
export const entryId = (spaceKey: string, seq: number) => `m_${spaceKey}_${seqStr(seq)}`;
export const seqOf = (id: string) => Number(id.slice(-12));
export const spaceOfId = (id: string) => id.split("_")[1] ?? "";
export const isEntryId = (id: string) => /^m_[a-z0-9]{8}_\d{12}$/.test(id);
export const checkpointId = (spaceKey: string, seq: number) => `cp_${spaceKey}_${seqStr(seq)}`;
export const teamIdFor = (spaceKey: string) => `sp_${spaceKey}`;

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function randomBase32(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += B32[b & 31];
  return out;
}
export const newSpaceKey = () => randomBase32(8);
export const conceptId = (spaceKey: string) => `c_${spaceKey}_${randomBase32(6)}`;
export const agentId = (spaceKey: string) => `a_${spaceKey}_${randomBase32(6)}`;
export const recallId = (spaceKey: string, at = Date.now()) => `r_${spaceKey}_${at}_${randomBase32(4)}`;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
/** First 6 and last 4 characters, the display form used across the UI. */
export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "—");
