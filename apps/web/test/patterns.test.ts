import { describe, expect, it } from "vitest";
import { AGENT_NAME_PATTERN, SPACE_KEY_PATTERN, SUBJECT_PATTERN, compilePattern } from "@/lib/client/patterns";

describe("pattern attributes compile under the v flag", () => {
  it("the old unescaped patterns did not (validation was silently off)", () => {
    expect(() => compilePattern("[a-z0-9_-]+:[a-z0-9_.-]+")).toThrow();
    expect(() => compilePattern("[a-zA-Z0-9 ._-]+")).toThrow();
  });

  it("subjects", () => {
    const re = compilePattern(SUBJECT_PATTERN);
    expect(re.test("customer:ada")).toBe(true);
    expect(re.test("ticket-1:export_v2.csv")).toBe(true);
    expect(re.test("customer ada")).toBe(false);
    expect(re.test("Customer:Ada")).toBe(false);
  });

  it("agent names", () => {
    const re = compilePattern(AGENT_NAME_PATTERN);
    expect(re.test("support-agent 2.0_x")).toBe(true);
    expect(re.test("bad/name")).toBe(false);
  });

  it("space keys", () => {
    expect(compilePattern(SPACE_KEY_PATTERN).test("k7m2q9xa")).toBe(true);
  });
});
