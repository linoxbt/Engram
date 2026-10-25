import "server-only";
import { z } from "zod";

/** The JSON form of a WebAuthn credential (`credential.toJSON()`); the backend verifies the contents. */
export const Credential = z.looseObject({ id: z.string().min(1).max(1024), type: z.literal("public-key"), response: z.looseObject({}) });
export const PasskeyName = z.string().trim().min(1).max(128);
