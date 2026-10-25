import { describe, expect, it } from "vitest";
import { parseEnvLine } from "../lib/env-parse";

describe("parseEnvLine", () => {
  it("strips inline comments after unquoted values", () => {
    expect(parseEnvLine("APPWRITE_DB_ID=engram   # the default")).toEqual(["APPWRITE_DB_ID", "engram"]);
    expect(parseEnvLine("# APPWRITE_EXPORTS_BUCKET=exports")).toBeNull();
    expect(parseEnvLine("CLASSIFIER_MODELS=")).toEqual(["CLASSIFIER_MODELS", ""]);
    expect(parseEnvLine("EMPTY= # nothing")).toEqual(["EMPTY", ""]);
  });

  it("keeps # inside quotes or without a preceding space, and handles export and spaces", () => {
    expect(parseEnvLine('SECRET="ab#cd # not a comment" # comment')).toEqual(["SECRET", "ab#cd # not a comment"]);
    expect(parseEnvLine("TOKEN='x#y'")).toEqual(["TOKEN", "x#y"]);
    expect(parseEnvLine("URL=https://x.io/#frag")).toEqual(["URL", "https://x.io/#frag"]);
    expect(parseEnvLine("export  NAME = value ")).toEqual(["NAME", "value"]);
    expect(parseEnvLine("")).toBeNull();
    expect(parseEnvLine("not a variable")).toBeNull();
  });
});
