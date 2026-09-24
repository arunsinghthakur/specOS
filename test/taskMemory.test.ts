import { describe, expect, it } from "vitest";
import { buildWorkerSystemPrompt, extractDoneSummary } from "../src/memory/taskMemory.js";
import type { SpecNode } from "../src/spec/schema.js";

const node: SpecNode = {
  id: "login",
  title: "Login",
  description: "Add a login form.",
  acceptanceCriteria: ["Valid credentials log the user in"],
  dependencies: [],
  priority: "high",
  nonFunctionalReqs: ["Response time under 200ms"],
  source: { type: "text", ref: "spec.txt" },
};

describe("buildWorkerSystemPrompt", () => {
  it("includes the task, acceptance criteria, and non-functional requirements", () => {
    const prompt = buildWorkerSystemPrompt(node, "", []);
    expect(prompt).toContain("Login");
    expect(prompt).toContain("Valid credentials log the user in");
    expect(prompt).toContain("Response time under 200ms");
  });

  it("includes project memory and completed-task summaries when provided", () => {
    const prompt = buildWorkerSystemPrompt(node, "Use TypeScript strict mode.", [
      { taskId: "signup", summary: "Added SignupService.create() in src/services/signup.ts", timestamp: "t" },
    ]);
    expect(prompt).toContain("Use TypeScript strict mode.");
    expect(prompt).toContain("SignupService.create()");
  });

  it("omits empty sections rather than leaving blank headers", () => {
    const prompt = buildWorkerSystemPrompt(node, "", []);
    expect(prompt).not.toContain("Project conventions:\n\n");
    expect(prompt).not.toContain("Already completed by other agents");
    expect(prompt).not.toContain("attempted before");
  });

  it("includes prior reviewer feedback on a retry", () => {
    const prompt = buildWorkerSystemPrompt(node, "", [], [
      { taskId: "login", feedback: "Missing a test for invalid credentials.", timestamp: "t" },
    ]);
    expect(prompt).toContain("rejected by the reviewer");
    expect(prompt).toContain("Missing a test for invalid credentials.");
  });
});

describe("extractDoneSummary", () => {
  it("extracts the text after a DONE: marker", () => {
    expect(extractDoneSummary("some reasoning...\nDONE: added login form in src/login.ts")).toBe(
      "added login form in src/login.ts",
    );
  });

  it("falls back to a truncated message when there is no DONE marker", () => {
    expect(extractDoneSummary("just some text")).toBe("just some text");
  });
});
