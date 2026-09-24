import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSpecNodes, writeSpecNodes } from "../src/spec/specFiles.js";
import type { SpecNode } from "../src/spec/schema.js";

function node(id: string, title = id): SpecNode {
  return {
    id,
    title,
    description: "desc",
    acceptanceCriteria: [],
    dependencies: [],
    priority: "medium",
    nonFunctionalReqs: [],
    source: { type: "text", ref: id },
  };
}

describe("specs/ persistence", () => {
  it("returns an empty array when the specs/ directory doesn't exist yet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-specs-"));
    try {
      expect(await readSpecNodes(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes one Markdown file per node, and reads them all back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-specs-"));
    try {
      await writeSpecNodes([node("a"), node("b")], dir);
      expect((await readSpecNodes(dir)).map((n) => n.id).sort()).toEqual(["a", "b"]);
      await expect(readFile(path.join(dir, "specs", "a.md"), "utf-8")).resolves.toContain("# a");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites only the node whose content changed, leaving other files untouched", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-specs-"));
    try {
      await writeSpecNodes([node("a"), node("b")], dir);

      const updatedA = node("a", "updated a");
      const changed = await writeSpecNodes([updatedA, node("c")], dir);

      expect(changed.map((p) => path.basename(p))).toEqual(["a.md", "c.md"]);

      const nodes = await readSpecNodes(dir);
      expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
      expect(nodes.find((n) => n.id === "a")?.title).toBe("updated a");
      expect(nodes.find((n) => n.id === "b")?.title).toBe("b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing and reports no changed paths when re-run with identical content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-specs-"));
    try {
      await writeSpecNodes([node("a")], dir);
      const changed = await writeSpecNodes([node("a")], dir);
      expect(changed).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
