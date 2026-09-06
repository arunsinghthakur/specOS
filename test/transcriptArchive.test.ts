import { describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveTranscript } from "../src/memory/transcriptArchive.js";

describe("archiveTranscript", () => {
  it("writes the full transcript to .specos/transcripts/<taskId>.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-archive-"));
    try {
      const transcript = [
        { role: "user" as const, content: "Begin implementing: Login" },
        { role: "assistant" as const, content: "DONE: added login form" },
      ];
      await archiveTranscript(dir, "task-1", transcript);

      const raw = await readFile(path.join(dir, ".specos", "transcripts", "task-1.json"), "utf-8");
      expect(JSON.parse(raw)).toEqual(transcript);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
