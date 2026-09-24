import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FeedbackMemory } from "../src/memory/feedbackMemory.js";

describe("FeedbackMemory", () => {
  it("returns an empty array before anything is appended", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-feedback-"));
    try {
      expect(await new FeedbackMemory(dir).all()).toEqual([]);
      expect(await new FeedbackMemory(dir).forTask("a")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends and reads back records in order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-feedback-"));
    try {
      const memory = new FeedbackMemory(dir);
      await memory.append({ taskId: "a", feedback: "missing tests", timestamp: "t1" });
      await memory.append({ taskId: "b", feedback: "wrong signature", timestamp: "t2" });

      const records = await memory.all();
      expect(records.map((r) => r.taskId)).toEqual(["a", "b"]);
      expect(records[0].feedback).toBe("missing tests");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forTask filters to a single task's feedback, preserving order across multiple rejections", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-feedback-"));
    try {
      const memory = new FeedbackMemory(dir);
      await memory.append({ taskId: "a", feedback: "missing tests", timestamp: "t1" });
      await memory.append({ taskId: "b", feedback: "wrong signature", timestamp: "t2" });
      await memory.append({ taskId: "a", feedback: "still failing lint", timestamp: "t3" });

      const records = await memory.forTask("a");
      expect(records.map((r) => r.feedback)).toEqual(["missing tests", "still failing lint"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
