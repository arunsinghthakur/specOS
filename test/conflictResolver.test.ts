import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commitAll, createWorktree, listUnmergedPaths } from "../src/integrations/git/worktree.js";
import { resolveConflict } from "../src/swarm/conflictResolver.js";
import type { AgentHandle, AgentProvider, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { SpecNode } from "../src/spec/schema.js";

const execFileAsync = promisify(execFile);
const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

async function initRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "original\n", "utf-8");
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
}

/** Diverges main and a worker branch so merging them conflicts on README.md. */
async function createConflict(repo: string): Promise<{ branch: string }> {
  const handle = await createWorktree(repo, "task-x", "main");
  await writeFile(path.join(handle.path, "README.md"), "change from worker\n", "utf-8");
  await commitAll(handle.path, "worker change");

  await writeFile(path.join(repo, "README.md"), "change from main\n", "utf-8");
  await execFileAsync("git", ["add", "-A"], { cwd: repo });
  await execFileAsync("git", ["commit", "-m", "main change"], { cwd: repo });

  return { branch: handle.branch };
}

const node: SpecNode = {
  id: "task-x",
  title: "Some task",
  description: "desc",
  acceptanceCriteria: [],
  dependencies: [],
  priority: "medium",
  nonFunctionalReqs: [],
  source: { type: "text", ref: "x" },
};

function providerThatResolves(): AgentProvider {
  return {
    name: "fake",
    async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: "fake",
        role: options.role,
        async sendMessage() {
          const writeFileTool = options.tools.find((t) => t.name === "write_file")!;
          const runCommandTool = options.tools.find((t) => t.name === "run_command")!;
          await writeFileTool.handler({ path: "README.md", content: "resolved content\n" });
          await runCommandTool.handler({ command: "git add README.md" });
          return { finalMessage: "DONE: took the worker's change", transcript: [], usage: ZERO_USAGE };
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

function providerThatGivesUp(): AgentProvider {
  return {
    name: "fake",
    async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: "fake",
        role: options.role,
        async sendMessage() {
          return { finalMessage: "UNRESOLVED: too risky to guess", transcript: [], usage: ZERO_USAGE };
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

function providerThatMustNotBeCalled(): AgentProvider {
  return {
    name: "fake",
    async createAgent(): Promise<AgentHandle> {
      throw new Error("should never be called — this isn't a content conflict, an agent can't fix it");
    },
  };
}

describe("resolveConflict", () => {
  it("reports the real git error, without invoking the agent, when the merge can't even start", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-conflict-"));
    try {
      await initRepo(repo);
      const handle = await createWorktree(repo, "task-x", "main");
      await writeFile(path.join(handle.path, ".gitignore"), "node_modules/\n", "utf-8");
      await commitAll(handle.path, "worker adds .gitignore");

      // Untracked (not committed) at the integration branch, at the same path the branch adds —
      // git refuses to even start the merge, leaving zero conflicted files.
      await writeFile(path.join(repo, ".gitignore"), "dist/\n", "utf-8");

      const result = await resolveConflict(providerThatMustNotBeCalled(), node, repo, handle.branch, "main");

      expect(result.resolved).toBe(false);
      expect(result.summary).not.toBe("no conflicting files found on real merge attempt");
      expect(result.summary).toContain(".gitignore");

      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });
      expect(status.stdout).toContain(".gitignore"); // untracked file untouched, working tree otherwise clean
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });


  it("leaves the merge staged (unmerged paths cleared) when the agent resolves it", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-conflict-"));
    try {
      await initRepo(repo);
      const { branch } = await createConflict(repo);

      const result = await resolveConflict(providerThatResolves(), node, repo, branch, "main");
      expect(result.resolved).toBe(true);
      expect(await listUnmergedPaths(repo)).toEqual([]);

      // A merge commit is still pending (index staged, nothing committed yet) — caller commits after approval.
      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });
      expect(status.stdout.trim()).not.toBe("");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("aborts and leaves a clean working tree when the agent can't resolve it", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-conflict-"));
    try {
      await initRepo(repo);
      const { branch } = await createConflict(repo);

      const result = await resolveConflict(providerThatGivesUp(), node, repo, branch, "main");
      expect(result.resolved).toBe(false);

      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });
      expect(status.stdout.trim()).toBe("");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
