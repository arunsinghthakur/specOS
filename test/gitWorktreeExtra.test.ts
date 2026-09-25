import { describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  commitPaths,
  createWorktree,
  currentBranchExists,
  deleteBranch,
  discardStaleWorktree,
  pushBranch,
  removeWorktree,
} from "../src/integrations/git/worktree.js";

const execFileAsync = promisify(execFile);

async function initRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "hello\n", "utf-8");
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
}

describe("currentBranchExists / deleteBranch", () => {
  it("reports existence correctly and deletes the branch", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-branch-"));
    try {
      await initRepo(repo);
      const handle = await createWorktree(repo, "task-1", "main");
      await removeWorktree(repo, handle);

      expect(await currentBranchExists(repo, handle.branch)).toBe(true);
      await deleteBranch(repo, handle.branch);
      expect(await currentBranchExists(repo, handle.branch)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("reports false for a branch that never existed", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-branch-"));
    try {
      await initRepo(repo);
      expect(await currentBranchExists(repo, "specos/never-existed")).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("discardStaleWorktree", () => {
  it("removes a leftover worktree and branch, so createWorktree for the same task id succeeds again", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-stale-"));
    try {
      await initRepo(repo);
      // Simulate a run that got killed mid-task: worktree + branch exist, nothing cleaned up.
      await createWorktree(repo, "task-1", "main");

      const discarded = await discardStaleWorktree(repo, "task-1");
      expect(discarded).toBe(true);
      expect(await currentBranchExists(repo, "specos/task-1")).toBe(false);

      // The real regression: retrying used to fail here with "a branch ... already exists".
      await expect(createWorktree(repo, "task-1", "main")).resolves.toMatchObject({ taskId: "task-1" });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("is a no-op and returns false when there's nothing to discard", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-stale-"));
    try {
      await initRepo(repo);
      expect(await discardStaleWorktree(repo, "never-ran")).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("removes a residual directory left behind even when the branch is already gone", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-stale-"));
    try {
      await initRepo(repo);
      // Observed live: `git worktree remove --force` can deregister the worktree and delete its
      // branch cleanly, yet still leave a residual directory at the target path — which then
      // makes the next `git worktree add` fail with "already exists" even though git itself has
      // no record of the worktree or branch anymore. Reproduce that directly, since it can't be
      // reproduced by just calling createWorktree/removeWorktree with well-behaved git.
      const worktreePath = path.join(repo, ".specos", "worktrees", "task-1");
      await mkdir(worktreePath, { recursive: true });
      await writeFile(path.join(worktreePath, "leftover.txt"), "stray file\n", "utf-8");
      expect(await currentBranchExists(repo, "specos/task-1")).toBe(false);

      const discarded = await discardStaleWorktree(repo, "task-1");
      expect(discarded).toBe(true);
      await expect(access(worktreePath)).rejects.toThrow();

      await expect(createWorktree(repo, "task-1", "main")).resolves.toMatchObject({ taskId: "task-1" });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("commitPaths", () => {
  it("stages and commits only the given paths, leaving other unstaged changes untouched", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-commit-"));
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "specs-a.txt"), "a\n", "utf-8");
      await writeFile(path.join(repo, "unrelated.txt"), "should stay unstaged\n", "utf-8");

      const committed = await commitPaths(repo, ["specs-a.txt"], "specos: spec — add a");
      expect(committed).toBe(true);

      const { stdout: log } = await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: repo });
      expect(log.trim()).toBe("specos: spec — add a");

      const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });
      expect(status).toContain("?? unrelated.txt");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("returns false and commits nothing when the given paths have no changes", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-commit-"));
    try {
      await initRepo(repo);
      const before = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo });

      const committed = await commitPaths(repo, ["README.md"], "no-op");

      expect(committed).toBe(false);
      const after = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo });
      expect(after.stdout).toBe(before.stdout);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("pushBranch", () => {
  it("pushes the integration branch to a local bare remote", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-push-"));
    const remote = await mkdtemp(path.join(tmpdir(), "specos-remote-"));
    try {
      await execFileAsync("git", ["init", "--bare", "-b", "main", remote]);
      await initRepo(repo);
      await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: repo });

      await pushBranch(repo, "origin", "main");

      const { stdout } = await execFileAsync("git", ["branch", "--list", "main"], { cwd: remote });
      expect(stdout).toContain("main");
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });
});
