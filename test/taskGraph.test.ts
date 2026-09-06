import { describe, expect, it } from "vitest";
import { TaskGraph } from "../src/spec/taskGraph.js";
import type { SpecNode } from "../src/spec/schema.js";

function node(id: string, dependencies: string[] = []): SpecNode {
  return {
    id,
    title: id,
    description: "",
    acceptanceCriteria: [],
    dependencies,
    priority: "medium",
    nonFunctionalReqs: [],
    source: { type: "text", ref: id },
  };
}

describe("TaskGraph", () => {
  it("orders tasks so dependencies come before dependents", () => {
    const graph = new TaskGraph([node("c", ["b"]), node("b", ["a"]), node("a")]);
    expect(graph.topologicalOrder()).toEqual(["a", "b", "c"]);
  });

  it("returns only tasks whose dependencies are satisfied as ready", () => {
    const graph = new TaskGraph([node("a"), node("b", ["a"]), node("c", ["a"])]);
    expect(graph.getReady(new Set()).map((n) => n.id)).toEqual(["a"]);
    expect(graph.getReady(new Set(["a"])).map((n) => n.id).sort()).toEqual(["b", "c"]);
  });

  it("throws on a dependency cycle", () => {
    expect(() => new TaskGraph([node("a", ["b"]), node("b", ["a"])])).toThrow(/cycle/);
  });

  it("throws when a task depends on an unknown task", () => {
    expect(() => new TaskGraph([node("a", ["missing"])])).toThrow(/unknown task/);
  });
});
