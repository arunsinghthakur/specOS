import { describe, expect, it } from "vitest";
import { parseMarkdownSpec } from "../src/spec/parsers/markdown.js";

describe("parseMarkdownSpec", () => {
  it("splits a file into one section per top-level heading", () => {
    const content = [
      "# Login feature",
      "Users can log in with email and password.",
      "",
      "## Password reset",
      "Users can reset a forgotten password via email link.",
    ].join("\n");

    const sections = parseMarkdownSpec("specs/auth.md", content);

    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe("auth-login-feature");
    expect(sections[0].sourceType).toBe("markdown");
    expect(sections[0].rawText).toContain("Users can log in");
    expect(sections[1].id).toBe("auth-password-reset");
    expect(sections[1].rawText).toContain("reset a forgotten password");
  });

  it("treats a headingless file as a single section", () => {
    const sections = parseMarkdownSpec("specs/note.txt", "Just a plain requirement, no heading.");
    expect(sections).toHaveLength(1);
    expect(sections[0].sourceType).toBe("text");
    expect(sections[0].rawText).toContain("plain requirement");
  });

  it("returns no sections for empty content", () => {
    expect(parseMarkdownSpec("specs/empty.md", "")).toHaveLength(0);
  });
});
