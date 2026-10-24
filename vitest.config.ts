import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@engram/core": r("./packages/core/src/index.ts"),
      "@engram/server": r("./packages/server/src/index.ts"),
      "engram-sdk": r("./packages/sdk/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
