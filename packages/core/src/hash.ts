import { canonical } from "./canonical";
import { toBase64, toHex } from "./encode";
import type { Header } from "./types";

const enc = new TextEncoder();

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(d);
}
export const sha256Hex = async (data: Uint8Array | string) => toHex(await sha256(data));

export const genesis = (space: string) => sha256Hex("engram:genesis:v1:" + space);
export const contentHash = (salt: string, text: string) =>
  sha256Hex(`engram:content:v1:${salt}:${text.normalize("NFC")}`);
export const headerHash = (h: Header) => sha256Hex("engram:entry:v1:" + canonical(h));

/** Round to 5 decimals so float32 storage round-trips to identical integers. */
export const quantize = (v: number[]) => v.map((x) => Math.round(x * 1e5) / 1e5);

export async function embHash(v: number[]): Promise<string> {
  const prefix = enc.encode("engram:emb:v1:");
  const buf = new Uint8Array(prefix.length + v.length * 4);
  buf.set(prefix, 0);
  const view = new DataView(buf.buffer);
  v.forEach((x, i) => view.setInt32(prefix.length + i * 4, Math.round(x * 1e5), true));
  return sha256Hex(buf);
}

export function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return toBase64(b);
}

/** Agent keys: `eng_<4 chars>_<secret>`. Only the SHA-256 and the prefix are stored. */
export const keyHash = (key: string) => sha256Hex("engram:agentkey:v1:" + key);

/** Constant-time comparison for equal-length strings (hashes, tokens). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
