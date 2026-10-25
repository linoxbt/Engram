/**
 * Bundle each Appwrite Function (with @engram/core and @engram/server inlined) into functions/<name>/dist/main.js,
 * minified. The source map is written outside dist (node_modules/.cache/engram-functions/<name>/main.js.map), so the
 * deployment archive (package.json + dist) does not carry it; use it locally to decode a stack trace.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const names = ["checkpoint", "sentinel", "labeler", "reflect"];
for (const name of names) {
  const outfile = `${root}functions/${name}/dist/main.js`;
  const mapDir = `${root}node_modules/.cache/engram-functions/${name}`;
  const res = await build({
    entryPoints: [`${root}functions/${name}/src/main.ts`],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: true,
    // Error classes are recognised by name across bundles (errors.ts), and readable names keep stack traces useful.
    keepNames: true,
    sourcemap: "external",
    write: false,
    legalComments: "none",
    alias: { "@engram/core": `${root}packages/core/src/index.ts`, "@engram/server": `${root}packages/server/src/index.ts` },
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  rmSync(`${root}functions/${name}/dist`, { recursive: true, force: true });
  mkdirSync(`${root}functions/${name}/dist`, { recursive: true });
  mkdirSync(mapDir, { recursive: true });
  let size = 0;
  for (const f of res.outputFiles) {
    if (f.path.endsWith(".map")) writeFileSync(`${mapDir}/main.js.map`, f.contents);
    else { writeFileSync(f.path, f.contents); size = f.contents.length; }
  }
  console.log(`built functions/${name}/dist/main.js (${Math.round(size / 1024)} KB; source map in node_modules/.cache/engram-functions/${name})`);
}
