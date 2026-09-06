import { describe, expect, it } from "vitest";
import { adfToPlainText } from "../src/integrations/jira/adf.js";

describe("adfToPlainText", () => {
  it("flattens paragraphs into newline-separated text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
      ],
    };
    const text = adfToPlainText(doc);
    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second paragraph.");
  });

  it("returns empty string for null/undefined input", () => {
    expect(adfToPlainText(null)).toBe("");
    expect(adfToPlainText(undefined)).toBe("");
  });

  it("concatenates adjacent inline text nodes within a paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Bold " }, { type: "text", text: "and plain." }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe("Bold and plain.");
  });
});
