import { describe, expect, it, vi } from "vitest";
import { LOGO, printBanner, printQuickStart } from "../src/cli/banner.js";

describe("banner", () => {
  it("renders a 5-row SPECOS logo with every row the same width", () => {
    const rows = LOGO.split("\n");
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });

  it("printBanner logs the logo and a tagline", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printBanner();
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain(LOGO);
      expect(output).toContain("Spec-driven, multi-agent SDLC orchestrator");
    } finally {
      spy.mockRestore();
    }
  });

  it("printQuickStart lists the first commands a new user should run", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printQuickStart();
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("specos setup");
      expect(output).toContain("specos init");
      expect(output).toContain("specos spec add");
      expect(output).toContain("specos plan");
      expect(output).toContain("specos run");
    } finally {
      spy.mockRestore();
    }
  });
});
