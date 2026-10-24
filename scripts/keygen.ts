/**
 * Generate the checkpoint signing key pair.
 *   pnpm keygen
 * Put CP_PRIVATE_KEY only in the checkpoint Function's variables (or a password
 * manager). Publish NEXT_PUBLIC_CP_PUBLIC_KEY on the verifier page and in the README.
 */
import { generateKeyPair } from "@engram/core";

const { privateKey, publicKey } = await generateKeyPair();
const keyId = `engram-cp-${new Date().toISOString().slice(0, 7)}`;
console.log(`# Checkpoint signing keys (Ed25519). Generated ${new Date().toISOString()}`);
console.log(`CP_KEY_ID=${keyId}`);
console.log(`CP_PRIVATE_KEY=${privateKey}`);
console.log(`NEXT_PUBLIC_CP_PUBLIC_KEY=${publicKey}`);
