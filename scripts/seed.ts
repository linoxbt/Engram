/**
 * Seed the demo story directly through the engine (no HTTP).
 *   pnpm seed -- --owner you@example.com [--variant demo|sandbox] [--name "Northwind support"] [--key k7m2q9xa] [--public]
 * Writes in chain order with past timestamps, through the real write path. The README says so.
 */
import "./env";
import { createSpace, getBackend, getConfig, getSpace, personCtx, seedStory, updateSettings } from "@engram/server";

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const owner = arg("owner");
const variant = (arg("variant") ?? "demo") as "demo" | "sandbox";
if (!owner) { console.error("Usage: pnpm seed -- --owner you@example.com [--variant demo|sandbox] [--name ...] [--key ...] [--public]"); process.exit(1); }

const b = getBackend();
console.log(`backend: ${b.kind}${getConfig().checkpoint.privateKey ? ", signing inline" : ", no signing key (checkpoints come from the Function)"}`);
const user = await b.auth.findUserByEmail(owner);
if (!user) { console.error(`No user with email ${owner}. Sign up in the app first.`); process.exit(1); }
const key = arg("key");
let space = key ? await getSpace(b, key) : null;
if (!space) space = await createSpace(b, { name: arg("name") ?? (variant === "sandbox" ? "Tamper Lab sandbox" : "Northwind support"), ownerId: user.id, ownerName: user.name, sandbox: variant === "sandbox", publicVerify: args.includes("--public"), key });
if (args.includes("--public") && !space.settings.publicVerify) await updateSettings(b, space.key, { publicVerify: true });
const t = Date.now();
const res = await seedStory(personCtx(b, (await getSpace(b, space.key))!, user), { variant, createdBy: `user:${user.id}` });
console.log(`\nSeeded space ${space.key}: ${res.entries} entries, ${res.duplicates} duplicate detected, ${res.checkpoints} checkpoints, ${Date.now() - t} ms.`);
for (const [name, k] of Object.entries(res.keys)) console.log(`  ${name.padEnd(18)} ${k}`);
console.log("\nAgent keys are shown once. Connect support-agent to Claude Code for the live part of the demo.");
