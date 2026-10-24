/** Bundle each Appwrite Function (with @engram/core and @engram/server inlined) into functions/<name>/dist/main.js. */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const names = ["checkpoint", "sentinel", "labeler", "reflect"];
for (const name of names) {
  await build({
    entryPoints: [`${root}functions/${name}/src/main.ts`],
    outfile: `${root}functions/${name}/dist/main.js`,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: true,
    legalComments: "none",
    alias: { "@engram/core": `${root}packages/core/src/index.ts`, "@engram/server": `${root}packages/server/src/index.ts` },
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  console.log(`built functions/${name}/dist/main.js`);
}
