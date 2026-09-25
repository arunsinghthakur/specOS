import { describe, expect, it } from "vitest";
import { parseTextSpec } from "../src/spec/parsers/text.js";

describe("parseTextSpec", () => {
  it("wraps the text as a single RawSpecInput with sourceType text", () => {
    const raw = parseTextSpec("Add a dark mode toggle to settings");
    expect(raw.sourceType).toBe("text");
    expect(raw.sourceRef).toBe("cli:--text");
    expect(raw.rawText).toBe("Add a dark mode toggle to settings");
  });

  it("derives a default id from the first few words when none is given", () => {
    const raw = parseTextSpec("Add a dark mode toggle to the settings screen");
    expect(raw.id).toBe("add-a-dark-mode-toggle-to");
  });

  it("uses an explicit --id when given, slugified", () => {
    const raw = parseTextSpec("Add a dark mode toggle", "Dark Mode!");
    expect(raw.id).toBe("dark-mode");
  });

  it("trims surrounding whitespace from the requirement text", () => {
    const raw = parseTextSpec("  Add dark mode  \n");
    expect(raw.rawText).toBe("Add dark mode");
  });

  it("throws on an empty requirement", () => {
    expect(() => parseTextSpec("   ")).toThrow(/empty/);
  });
});
