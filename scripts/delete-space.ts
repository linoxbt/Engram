/**
 * Delete a space and everything in it (memories, concepts, recalls, agents, checkpoint and export files, team).
 *   pnpm tsx scripts/delete-space.ts <spaceKey>
 */
import "./env";
import { deleteSpace, getBackend } from "@engram/server";

const key = process.argv[2];
if (!key || !/^[a-z0-9]{8}$/.test(key)) { console.error("Usage: tsx scripts/delete-space.ts <spaceKey>"); process.exit(1); }
await deleteSpace(getBackend(), key);
console.log(`Deleted space ${key}.`);
