import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSpecLock, writeSpecLock } from "../src/spec/lock.js";
import type { SpecNode } from "../src/spec/schema.js";

function node(id: string): SpecNode {
  return {
    id,
    title: id,
    description: "desc",
    acceptanceCriteria: [],
    dependencies: [],
    priority: "medium",
    nonFunctionalReqs: [],
    source: { type: "text", ref: id },
  };
}

describe("spec.lock.json persistence", () => {
  it("returns an empty array when no lock file exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-lock-"));
    try {
      expect(await readSpecLock(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes and re-reads nodes, merging by id on subsequent writes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-lock-"));
    try {
      await writeSpecLock([node("a"), node("b")], dir);
      expect((await readSpecLock(dir)).map((n) => n.id).sort()).toEqual(["a", "b"]);

      const updatedA = { ...node("a"), title: "updated a" };
      await writeSpecLock([updatedA, node("c")], dir);

      const nodes = await readSpecLock(dir);
      expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
      expect(nodes.find((n) => n.id === "a")?.title).toBe("updated a");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
