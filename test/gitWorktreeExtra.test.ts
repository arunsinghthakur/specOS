import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
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
