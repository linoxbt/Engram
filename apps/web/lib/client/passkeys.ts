"use client";
/**
 * Passkeys in the browser. The server (Appwrite, or the local backend) issues WebAuthn options and verifies the
 * result; this file only runs the browser ceremony in between, through @simplewebauthn/browser, which handles
 * the base64url conversions on every browser that supports WebAuthn.
 */
import {
  browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api, ApiError } from "./api";

export interface Passkey { id: string; name: string; createdAt: string; lastUsedAt: string | null }

export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

/** Browser-side failures as ApiErrors, so forms show them like any other error. Cancelling is its own code. */
function ceremonyError(e: unknown): Error {
  if (e instanceof ApiError) return e;
  const name = e instanceof Error ? e.name : "";
  const code = e instanceof WebAuthnError ? e.code : "";
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") {
    return new ApiError(0, "passkey_cancelled", "The passkey request was cancelled or timed out.");
  }
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return new ApiError(0, "passkey_exists", "This device already has a passkey for your account.");
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") {
    return new ApiError(0, "passkey_domain", "Passkeys are not set up for this site's address. Check the passkey relying party in the Appwrite console.");
  }
  return new ApiError(0, "passkey_failed", e instanceof Error && e.message ? e.message : "The passkey request failed.");
}

/** Create a passkey on this device for the signed-in account. Needs a sign-in in the last 10 minutes. */
export async function addPasskey(name: string): Promise<Passkey> {
  const start = await api<{ passkeyId: string; publicKey: PublicKeyCredentialCreationOptionsJSON }>("/api/auth/passkeys", { method: "POST", json: { name } });
  let credential;
  try { credential = await startRegistration({ optionsJSON: start.publicKey }); } catch (e) { throw ceremonyError(e); }
  const { passkey } = await api<{ passkey: Passkey }>("/api/auth/passkeys/verify", { method: "POST", json: { passkeyId: start.passkeyId, credential } });
  return passkey;
}

/** Sign in with any passkey saved for this site. No email needed: the device lists the accounts it has. */
export async function signInWithPasskey(): Promise<void> {
  const start = await api<{ challengeId: string; publicKey: PublicKeyCredentialRequestOptionsJSON }>("/api/auth/passkeys/sign-in", { method: "POST" });
  let credential;
  try { credential = await startAuthentication({ optionsJSON: start.publicKey }); } catch (e) { throw ceremonyError(e); }
  await api("/api/auth/passkeys/sign-in/verify", { method: "POST", json: { challengeId: start.challengeId, credential } });
}

/** A default name from the device, so the list tells passkeys apart. */
export function defaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "this device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${browser} on ${os}` : `Passkey on ${os}`;
}
