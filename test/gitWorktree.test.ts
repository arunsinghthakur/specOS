import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commitAll, createWorktree, dryRunMerge, mergeBranch, removeWorktree } from "../src/integrations/git/worktree.js";

const execFileAsync = promisify(execFile);

async function initRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "hello\n", "utf-8");
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
}

describe("git worktree integration", () => {
  it("creates a worktree, commits work, and merges it cleanly into main", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-git-"));
    try {
      await initRepo(repo);

      const handle = await createWorktree(repo, "task-1", "main");
      expect(handle.branch).toBe("specos/task-1");

      await writeFile(path.join(handle.path, "feature.txt"), "new feature\n", "utf-8");
      const committed = await commitAll(handle.path, "add feature");
      expect(committed).toBe(true);

      const clean = await dryRunMerge(repo, handle.branch, "main");
      expect(clean).toBe(true);

      await mergeBranch(repo, handle.branch, "main");
      const merged = await readFile(path.join(repo, "feature.txt"), "utf-8");
      expect(merged).toBe("new feature\n");

      await removeWorktree(repo, handle);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("commitAll returns false when there is nothing to commit", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-git-"));
    try {
      await initRepo(repo);
      const handle = await createWorktree(repo, "task-2", "main");
      expect(await commitAll(handle.path, "no-op")).toBe(false);
      await removeWorktree(repo, handle);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("dryRunMerge reports a conflict without touching the integration branch", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-git-"));
    try {
      await initRepo(repo);

      const handle = await createWorktree(repo, "task-3", "main");
      await writeFile(path.join(handle.path, "README.md"), "conflicting change from worker\n", "utf-8");
      await commitAll(handle.path, "conflicting change");

      // Diverge main so merging the worker branch back in conflicts.
      await writeFile(path.join(repo, "README.md"), "conflicting change from main\n", "utf-8");
      await execFileAsync("git", ["add", "-A"], { cwd: repo });
      await execFileAsync("git", ["commit", "-m", "diverge main"], { cwd: repo });

      const clean = await dryRunMerge(repo, handle.branch, "main");
      expect(clean).toBe(false);

      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });
      expect(status.stdout.trim()).toBe("");

      await removeWorktree(repo, handle);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
