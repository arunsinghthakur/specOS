import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReadOnlyTools, buildWorkerTools } from "../src/swarm/tools.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "specos-tools-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("buildWorkerTools", () => {
  it("writes then reads back a file within the worktree root", async () => {
    await withTempDir(async (dir) => {
      const tools = buildWorkerTools(dir);
      const write = tools.find((t) => t.name === "write_file")!;
      const read = tools.find((t) => t.name === "read_file")!;

      await write.handler({ path: "src/index.ts", content: "export const x = 1;" });
      const content = await read.handler({ path: "src/index.ts" });
      expect(content).toBe("export const x = 1;");
    });
  });

  it("rejects paths that escape the worktree root", async () => {
    await withTempDir(async (dir) => {
      const tools = buildWorkerTools(dir);
      const read = tools.find((t) => t.name === "read_file")!;
      await expect(read.handler({ path: "../../etc/passwd" })).rejects.toThrow(/escapes/);
    });
  });

  it("runs a shell command scoped to the worktree cwd", async () => {
    await withTempDir(async (dir) => {
      await fsWriteFile(path.join(dir, "marker.txt"), "hi", "utf-8");
      const tools = buildWorkerTools(dir);
      const run = tools.find((t) => t.name === "run_command")!;
      const result = (await run.handler({ command: "ls" })) as { ok: boolean; stdout: string };
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("marker.txt");
    });
  });
});

describe("buildReadOnlyTools", () => {
  it("does not expose a write_file tool", async () => {
    await withTempDir(async (dir) => {
      const tools = buildReadOnlyTools(dir);
      expect(tools.find((t) => t.name === "write_file")).toBeUndefined();
      expect(tools.map((t) => t.name).sort()).toEqual(["list_dir", "read_file", "run_command"]);
    });
  });
});
