import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigSchema } from "../src/config/schema.js";
import { StateStore } from "../src/storage/stateStore.js";
import { AutoApproveGateHandler } from "../src/harness/approvalGate.js";
import { runOrchestrator } from "../src/orchestrator/orchestrator.js";
import { writeSpecNodes } from "../src/spec/specFiles.js";
import { SwarmMemory } from "../src/memory/swarmMemory.js";
import { FeedbackMemory } from "../src/memory/feedbackMemory.js";
import { createWorktree } from "../src/integrations/git/worktree.js";
import type { AgentHandle, AgentProvider, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { SpecNode } from "../src/spec/schema.js";

const execFileAsync = promisify(execFile);
const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

async function initRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("sh", ["-c", "echo hello > README.md"], { cwd: dir });
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
}

function node(id: string, title: string): SpecNode {
  return {
    id,
    title,
    description: `Implement ${title}`,
    acceptanceCriteria: [],
    dependencies: [],
    priority: "medium",
    nonFunctionalReqs: [],
    source: { type: "text", ref: id },
  };
}

/** Worker writes a file named after the task id; reviewer always approves. */
function fakeProvider(): AgentProvider {
  return {
    name: "fake",
    async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: `${options.role}-fake`,
        role: options.role,
        async sendMessage(content: string) {
          if (options.role === "worker") {
            const match = /Begin implementing: (.*)/.exec(content);
            const write = options.tools.find((t) => t.name === "write_file")!;
            await write.handler({ path: `${match?.[1] ?? "output"}.txt`, content: "implemented\n" });
            return { finalMessage: `DONE: implemented ${match?.[1]}`, transcript: [], usage: ZERO_USAGE };
          }
          if (options.role === "reviewer") {
            return { finalMessage: '{"approved": true, "feedback": "looks good"}', transcript: [], usage: ZERO_USAGE };
          }
          return { finalMessage: "DONE: n/a", transcript: [], usage: ZERO_USAGE };
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

describe("runOrchestrator", () => {
  it("processes two independent tasks concurrently and merges both into the integration branch", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-orchestrator-"));
    try {
      await initRepo(repo);
      await writeSpecNodes([node("feature-a", "Feature A"), node("feature-b", "Feature B")], repo);

      const config = ConfigSchema.parse({ concurrency: 2 });
      const stateStore = new StateStore(repo);

      await runOrchestrator({
        provider: fakeProvider(),
        config,
        stateStore,
        repoRoot: repo,
        approvalGate: new AutoApproveGateHandler(),
      });

      const tasks = stateStore.listTasks();
      expect(tasks.map((t) => t.status).sort()).toEqual(["merged", "merged"]);

      await expect(access(path.join(repo, "Feature A.txt"))).resolves.toBeUndefined();
      await expect(access(path.join(repo, "Feature B.txt"))).resolves.toBeUndefined();

      const summaries = await new SwarmMemory(repo).all();
      expect(summaries.map((s) => s.taskId).sort()).toEqual(["feature-a", "feature-b"]);

      stateStore.close();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("records reviewer rejection feedback so a retried worker can see why it was blocked", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-orchestrator-"));
    try {
      await initRepo(repo);
      await writeSpecNodes([node("feature-a", "Feature A")], repo);

      const config = ConfigSchema.parse({ concurrency: 1 });
      const stateStore = new StateStore(repo);

      const rejectingProvider: AgentProvider = {
        name: "fake-rejecting",
        async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
          return {
            id: `${options.role}-fake`,
            role: options.role,
            async sendMessage(content: string) {
              if (options.role === "worker") {
                const match = /Begin implementing: (.*)/.exec(content);
                const write = options.tools.find((t) => t.name === "write_file")!;
                await write.handler({ path: `${match?.[1] ?? "output"}.txt`, content: "implemented\n" });
                return { finalMessage: `DONE: implemented ${match?.[1]}`, transcript: [], usage: ZERO_USAGE };
              }
              if (options.role === "reviewer") {
                return {
                  finalMessage: '{"approved": false, "feedback": "Missing a test for the empty-input case."}',
                  transcript: [],
                  usage: ZERO_USAGE,
                };
              }
              return { finalMessage: "DONE: n/a", transcript: [], usage: ZERO_USAGE };
            },
            getUsage: () => ZERO_USAGE,
          };
        },
      };

      await runOrchestrator({
        provider: rejectingProvider,
        config,
        stateStore,
        repoRoot: repo,
        approvalGate: new AutoApproveGateHandler(),
      });

      const tasks = stateStore.listTasks();
      expect(tasks.map((t) => t.status)).toEqual(["blocked"]);

      const feedback = await new FeedbackMemory(repo).forTask("feature-a");
      expect(feedback).toHaveLength(1);
      expect(feedback[0].feedback).toBe("Missing a test for the empty-input case.");

      stateStore.close();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("streams live tool-call and narration activity from the worker as it happens, not just at the end", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-orchestrator-"));
    try {
      await initRepo(repo);
      await writeSpecNodes([node("feature-a", "Feature A")], repo);

      const streamingProvider: AgentProvider = {
        name: "fake-streaming",
        async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
          return {
            id: `${options.role}-fake`,
            role: options.role,
            async sendMessage() {
              if (options.role === "worker") {
                options.onActivity?.({ type: "text", text: "Writing the storage module now" });
                options.onActivity?.({ type: "tool_call", tool: "write_file", input: { path: "Feature A.txt" } });
                const write = options.tools.find((t) => t.name === "write_file")!;
                await write.handler({ path: "Feature A.txt", content: "implemented\n" });
                return { finalMessage: "DONE: implemented Feature A", transcript: [], usage: ZERO_USAGE };
              }
              if (options.role === "reviewer") {
                return { finalMessage: '{"approved": true, "feedback": "looks good"}', transcript: [], usage: ZERO_USAGE };
              }
              return { finalMessage: "DONE: n/a", transcript: [], usage: ZERO_USAGE };
            },
            getUsage: () => ZERO_USAGE,
          };
        },
      };

      const config = ConfigSchema.parse({ concurrency: 1 });
      const stateStore = new StateStore(repo);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      let lines: string[];

      try {
        await runOrchestrator({
          provider: streamingProvider,
          config,
          stateStore,
          repoRoot: repo,
          approvalGate: new AutoApproveGateHandler(),
        });
      } finally {
        lines = logSpy.mock.calls.map((call) => call.join(" "));
        logSpy.mockRestore();
      }

      expect(lines).toContainEqual("[feature-a] · Writing the storage module now");
      expect(lines).toContainEqual("[feature-a] → write_file Feature A.txt");

      stateStore.close();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("recovers a task whose worktree/branch was left behind by an earlier killed run, instead of failing", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-orchestrator-"));
    try {
      await initRepo(repo);
      await writeSpecNodes([node("feature-a", "Feature A")], repo);

      // Simulate `specos run` being killed mid-task: the worktree/branch from that attempt is
      // still there, and the state store never advanced past "in_progress".
      await createWorktree(repo, "feature-a", "main");
      const config = ConfigSchema.parse({ concurrency: 1 });
      const stateStore = new StateStore(repo);
      stateStore.upsertTask("feature-a", "in_progress");

      await runOrchestrator({
        provider: fakeProvider(),
        config,
        stateStore,
        repoRoot: repo,
        approvalGate: new AutoApproveGateHandler(),
      });

      const tasks = stateStore.listTasks();
      expect(tasks.map((t) => t.status)).toEqual(["merged"]);
      await expect(access(path.join(repo, "Feature A.txt"))).resolves.toBeUndefined();

      stateStore.close();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
