/**
 * Two things about `pnpm functions:deploy` that only bite in production: which tsx it runs, and when it prunes
 * variables. Neither is reachable without an Appwrite project, so the ordering is a pure function and the command
 * is asserted against the source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitActions, type VarAction } from "../deploy-plan";

const source = readFileSync(fileURLToPath(new URL("../deploy-functions.ts", import.meta.url)), "utf8");

describe("functions:deploy", () => {
  it("prunes variables only after the new code is deployed", () => {
    const actions: VarAction[] = [
      { kind: "create", key: "APPWRITE_DB_ID", value: "engram", secret: false },
      { kind: "delete", key: "OLD_FLAG", variableId: "v1" },
      { kind: "keep", key: "CP_PRIVATE_KEY", reason: "existing signing key kept" },
      { kind: "update", key: "CP_PUBLIC_KEYS", value: "id:hex", secret: false, variableId: "v2" },
    ];
    const { beforeDeploy, afterDeploy } = splitActions(actions);
    expect(beforeDeploy.map((a) => a.key)).toEqual(["APPWRITE_DB_ID", "CP_PRIVATE_KEY", "CP_PUBLIC_KEYS"]);
    expect(afterDeploy.map((a) => a.key)).toEqual(["OLD_FLAG"]);
    // A deployment that throws leaves the Function on its old code, so nothing may be pruned before it lands.
    expect(afterDeploy.every((a) => a.kind === "delete")).toBe(true);
    expect(source.indexOf("for (const a of afterDeploy)")).toBeGreaterThan(source.indexOf("createDeployment"));
    expect(source.indexOf("for (const a of beforeDeploy)")).toBeLessThan(source.indexOf("createDeployment"));
  });

  it("runs tsx from node_modules, never through npx", () => {
    // npx silently fetches a current version from the registry when node_modules/.bin/tsx is not resolvable.
    expect(source).not.toMatch(/["']npx["']/);
    expect(source).toContain('spawnSync(process.execPath, ["--import", "tsx"');
  });
});
