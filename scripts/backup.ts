/**
 * Export what Appwrite's database backups do not cover, to a local JSON file:
 *  - every space team (sp_*): name, preferences (space settings, including the latestCheckpoint trust anchor) and
 *    memberships (user ID, email, roles);
 *  - every file in the checkpoints bucket (and the exports bucket, if separate): signed checkpoints, lock files and
 *    any server state files, base64-encoded with their permissions.
 *
 *   pnpm backup                               # writes ~/engram-backups/engram-<project>-<time>.json
 *   pnpm backup -- --out ./somewhere.json
 *   pnpm backup -- --restore ./somewhere.json [--dry-run]
 *
 * Restore is deliberately conservative: a team is recreated with its preferences only if it no longer exists (an
 * existing team's settings, and its latestCheckpoint anchor, are never overwritten or moved backwards); files are
 * created with their original IDs and an existing file is left alone. Memberships are listed, not re-created
 * (the users must exist first; re-invite them). The file holds space settings and invite hashes: keep it private.
 */
import "./env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Client, Storage, Teams } from "node-appwrite";
import { collectBackup, restoreBackup, type BackupFile } from "./lib/backup";

const endpoint = process.env.APPWRITE_ENDPOINT, project = process.env.APPWRITE_PROJECT_ID, key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) { console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY."); process.exit(1); }
const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const teams = new Teams(client), storage = new Storage(client);
const buckets = [...new Set([process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints", process.env.APPWRITE_EXPORTS_BUCKET].filter((b): b is string => !!b))];
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

const restorePath = arg("restore");
if (restorePath) {
  await restoreBackup(teams, storage, JSON.parse(readFileSync(restorePath, "utf8")) as BackupFile, args.includes("--dry-run"));
} else {
  const out = arg("out") ?? join(homedir(), "engram-backups", `engram-${project}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const dump = await collectBackup(teams, storage, buckets, { endpoint, project });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dump), { mode: 0o600 });
  console.log(`✓ ${dump.teams.length} spaces and ${dump.files.length} files written to ${out}`);
}
