import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorktree, currentBranchExists } from "../src/integrations/git/worktree.js";
import { StateStore } from "../src/storage/stateStore.js";
import { executeRetry } from "../src/cli/retryAction.js";

const execFileAsync = promisify(execFile);

async function initRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "hello\n", "utf-8");
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
}

describe("executeRetry", () => {
  it("discards the worktree/branch and resets a blocked task to pending", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-retry-"));
    const originalCwd = process.cwd();
    try {
      await initRepo(repo);
      const handle = await createWorktree(repo, "task-1", "main");

      const store = new StateStore(repo);
      store.upsertTask("task-1", "blocked", handle.path, handle.branch);
      store.close();

      process.chdir(repo);
      await executeRetry("task-1", { yes: true });

      expect(await currentBranchExists(repo, handle.branch)).toBe(false);

      const verify = new StateStore(repo);
      const record = verify.getTask("task-1");
      expect(record?.status).toBe("pending");
      expect(record?.branch).toBeNull();
      verify.close();
    } finally {
      process.chdir(originalCwd);
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("throws for a task that is not blocked or failed", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-retry-"));
    const originalCwd = process.cwd();
    try {
      await initRepo(repo);
      const store = new StateStore(repo);
      store.upsertTask("task-2", "merged");
      store.close();

      process.chdir(repo);
      await expect(executeRetry("task-2", { yes: true })).rejects.toThrow(/not blocked or failed/);
    } finally {
      process.chdir(originalCwd);
      await rm(repo, { recursive: true, force: true });
    }
  });
});
