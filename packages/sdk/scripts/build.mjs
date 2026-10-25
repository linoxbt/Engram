/**
 * Publishable build. @engram/core is a private, source-only workspace package, so it is bundled into dist/index.js
 * (the same code the server runs, not a copy); tsc writes declarations for both, and the core import in them is
 * pointed at the bundled copy. Only @noble/ed25519 stays a runtime dependency.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: [join(root, "src/index.ts")], outfile: join(dist, "index.js"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["@noble/ed25519"], legalComments: "none",
});

execFileSync(process.execPath, [createRequire(import.meta.url).resolve("typescript/bin/tsc"), "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });

// Node16/NodeNext consumers need explicit extensions in declaration imports.
const types = join(dist, "types");
const coreIndex = join(types, "core/src/index.d.ts");
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const file of walk(types).filter((f) => f.endsWith(".d.ts"))) {
  let rel = relative(dirname(file), coreIndex).replace(/\.d\.ts$/, ".js");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const src = readFileSync(file, "utf8")
    .replace(/(from |import\()(["'])@engram\/core\2/g, `$1$2${rel}$2`)
    .replace(/(from |import\()(["'])(\.{1,2}\/[^"']+?)(?<!\.js)\2/g, "$1$2$3.js$2");
  writeFileSync(file, src);
}
console.log("built engram-sdk into dist/");
