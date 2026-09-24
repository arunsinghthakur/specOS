import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  commitPaths,
  createWorktree,
  currentBranchExists,
  deleteBranch,
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
