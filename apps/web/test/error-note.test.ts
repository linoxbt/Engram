import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/client/api";
import { ErrorNote } from "@/components/ui";

const html = (error: unknown) => renderToStaticMarkup(createElement(ErrorNote, { error }));

describe("ErrorNote turns a guest's refusal into a sign-up prompt", () => {
  it("a read_only error offers an account instead of a red alert", () => {
    const out = html(new ApiError(403, "read_only", "This is a read-only demo. Create a free account to write memories."));
    expect(out).toContain("/signup");
    expect(out).toContain("Create a free account");
    expect(out).not.toContain('role="alert"');
  });

  it("every other error still reads as a failure", () => {
    const out = html(new ApiError(500, "internal", "Something broke."));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Something broke.");
    expect(out).not.toContain("/signup");
  });

  it("nothing is rendered without an error", () => {
    expect(html(null)).toBe("");
  });
});
