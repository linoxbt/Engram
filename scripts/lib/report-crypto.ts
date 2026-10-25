/**
 * Provisioning reports are encrypted to the operator's X25519 public key before they are written anywhere a web
 * server could serve them. Sealed-box style, node:crypto only:
 *   ephemeral X25519 key pair → ECDH with the recipient key → HKDF-SHA256 → AES-256-GCM.
 * The envelope is JSON with base64 fields, so it can be published as a static file and fetched later.
 */
import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes,
  type KeyObject,
} from "node:crypto";

export const REPORT_ALG = "X25519-HKDF-SHA256-AES-256-GCM";
const INFO = Buffer.from("engram-provision-report-v1");

export interface ReportEnvelope { v: "1"; alg: typeof REPORT_ALG; kid: string; epk: string; iv: string; tag: string; ct: string }

const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64");

/** Raw 32-byte X25519 public key from a KeyObject. */
export function rawPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("not an X25519 public key");
  return Buffer.from(jwk.x, "base64url");
}

/**
 * ENGRAM_REPORT_PUBKEY: the raw 32-byte X25519 public key as base64 (what `decrypt-report --keygen` prints),
 * as 64 hex characters, or a PEM SPKI block.
 */
export function parsePublicKey(text: string): KeyObject {
  const s = text.trim();
  if (s.includes("BEGIN PUBLIC KEY")) {
    const k = createPublicKey(s);
    if (k.asymmetricKeyType !== "x25519") throw new Error("ENGRAM_REPORT_PUBKEY must be an X25519 key");
    return k;
  }
  const raw = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, "hex") : unb64(s);
  if (raw.length !== 32) throw new Error("ENGRAM_REPORT_PUBKEY must be a 32-byte X25519 public key (base64 or hex)");
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" });
}

/** The private key file: PEM PKCS#8 (what --keygen writes), or the raw 32-byte key as base64/hex. */
export function parsePrivateKey(text: string): KeyObject {
  const s = text.trim();
  if (s.includes("BEGIN PRIVATE KEY")) {
    const k = createPrivateKey(s);
    if (k.asymmetricKeyType !== "x25519") throw new Error("the private key must be an X25519 key");
    return k;
  }
  const d = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, "hex") : unb64(s);
  if (d.length !== 32) throw new Error("the private key must be a 32-byte X25519 key or a PEM PKCS#8 block");
  // A JWK private key needs x as well; derive it by importing d alone through PKCS#8 DER.
  const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), d]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** Short fingerprint of a public key, stored in the envelope so the right private key can be picked. */
export const keyId = (pub: KeyObject) => rawPublicKey(pub).subarray(0, 6).toString("hex");

function deriveKey(shared: Buffer, epk: Buffer, rpk: Buffer) {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, rpk]), INFO, 32));
}

export function encryptReport(plaintext: string, recipient: KeyObject): ReportEnvelope {
  const eph = generateKeyPairSync("x25519");
  const epk = rawPublicKey(eph.publicKey), rpk = rawPublicKey(recipient);
  const key = deriveKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), epk, rpk);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(INFO);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: "1", alg: REPORT_ALG, kid: keyId(recipient), epk: b64(epk), iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) };
}

export function decryptReport(env: ReportEnvelope, privateKey: KeyObject): string {
  if (env.v !== "1" || env.alg !== REPORT_ALG) throw new Error(`unsupported report envelope (${env.v}, ${env.alg})`);
  const pub = createPublicKey(privateKey);
  const epk = unb64(env.epk), rpk = rawPublicKey(pub);
  const ephKey = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: epk.toString("base64url") }, format: "jwk" });
  const key = deriveKey(diffieHellman({ privateKey, publicKey: ephKey }), epk, rpk);
  const decipher = createDecipheriv("aes-256-gcm", key, unb64(env.iv));
  decipher.setAAD(INFO);
  decipher.setAuthTag(unb64(env.tag));
  return Buffer.concat([decipher.update(unb64(env.ct)), decipher.final()]).toString("utf8");
}

/** A new recipient key pair: PEM private key for the operator's machine, base64 raw public key for the env var. */
export function generateReportKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), publicKey: b64(rawPublicKey(publicKey)) };
}
