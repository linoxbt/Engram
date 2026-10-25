/** Load .env / .env.local for scripts (no dependency). Variables already in the environment win. */
import { existsSync, readFileSync } from "node:fs";
import { parseEnvLine } from "./lib/env-parse";

for (const f of [".env.local", ".env", "apps/web/.env.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const kv = parseEnvLine(line);
    if (kv && !process.env[kv[0]]) process.env[kv[0]] = kv[1];
  }
}
