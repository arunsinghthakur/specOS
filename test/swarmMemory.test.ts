import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SwarmMemory } from "../src/memory/swarmMemory.js";

describe("SwarmMemory", () => {
  it("returns an empty array before anything is appended", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-swarm-"));
    try {
      expect(await new SwarmMemory(dir).all()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends and reads back records in order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-swarm-"));
    try {
      const memory = new SwarmMemory(dir);
      await memory.append({ taskId: "a", summary: "did a", timestamp: "t1" });
      await memory.append({ taskId: "b", summary: "did b", timestamp: "t2" });

      const records = await memory.all();
      expect(records.map((r) => r.taskId)).toEqual(["a", "b"]);
      expect(records[0].summary).toBe("did a");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
