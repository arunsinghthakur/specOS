import { describe, expect, it } from "vitest";
import { nodeToMarkdown, markdownToNode } from "../src/spec/specMarkdown.js";
import type { SpecNode } from "../src/spec/schema.js";

const full: SpecNode = {
  id: "PROJ-45",
  title: "Validate login form inputs",
  description: "Reject empty or malformed credentials before hitting the auth service.",
  acceptanceCriteria: ["Empty email or password shows an inline error", "Malformed email shows an error"],
  dependencies: ["PROJ-40", "PROJ-41"],
  priority: "high",
  epic: "PROJ-1",
  nonFunctionalReqs: ["Client-side validation must run in under 50ms"],
  source: { type: "jira", ref: "PROJ-45" },
};

const minimal: SpecNode = {
  id: "spec-todo-storage",
  title: "Todo storage",
  description: "In-memory todo storage.",
  acceptanceCriteria: ["Exports createStore()"],
  dependencies: [],
  priority: "medium",
  nonFunctionalReqs: [],
  source: { type: "markdown", ref: "spec.md#Todo Storage" },
};

describe("nodeToMarkdown / markdownToNode round-trip", () => {
  it("round-trips a node with every optional field populated", () => {
    expect(markdownToNode(nodeToMarkdown(full))).toEqual(full);
  });

  it("round-trips a minimal node with no epic, dependencies, or non-functional reqs", () => {
    expect(markdownToNode(nodeToMarkdown(minimal))).toEqual(minimal);
  });

  it("omits empty sections rather than leaving blank frontmatter keys or headers", () => {
    const md = nodeToMarkdown(minimal);
    expect(md).not.toContain("epic:");
    expect(md).not.toContain("dependencies:");
    expect(md).not.toContain("Non-functional requirements");
  });

  it("re-serializing the same node twice produces byte-identical output", () => {
    expect(nodeToMarkdown(full)).toBe(nodeToMarkdown(full));
  });
});
