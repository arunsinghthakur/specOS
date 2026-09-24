import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigSchema } from "../src/config/schema.js";
import { StateStore } from "../src/storage/stateStore.js";
import { AutoApproveGateHandler } from "../src/harness/approvalGate.js";
import { runOrchestrator } from "../src/orchestrator/orchestrator.js";
import { writeSpecNodes } from "../src/spec/specFiles.js";
import type { AgentHandle, AgentProvider, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { SpecNode } from "../src/spec/schema.js";

const execFileAsync = promisify(execFile);

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

/** Every worker call reports 50 input tokens; reviewer always approves. */
function fakeProvider(): AgentProvider {
  const usage: TokenUsage = { inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const zero: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
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
            return { finalMessage: `DONE: implemented ${match?.[1]}`, transcript: [], usage };
          }
          if (options.role === "reviewer") {
            return { finalMessage: '{"approved": true, "feedback": "looks good"}', transcript: [], usage: zero };
          }
          return { finalMessage: "DONE: n/a", transcript: [], usage: zero };
        },
        getUsage: () => zero,
      };
    },
  };
}

describe("runOrchestrator token budget", () => {
  it("stops starting new tasks once cumulative usage reaches the configured maxTokens", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "specos-budget-"));
    try {
      await initRepo(repo);
      await writeSpecNodes(
        [node("feature-a", "Feature A"), node("feature-b", "Feature B"), node("feature-c", "Feature C")],
        repo,
      );

      const config = ConfigSchema.parse({ concurrency: 1, budget: { maxTokens: 50 } });
      const stateStore = new StateStore(repo);

      await runOrchestrator({
        provider: fakeProvider(),
        config,
        stateStore,
        repoRoot: repo,
        approvalGate: new AutoApproveGateHandler(),
      });

      const tasks = stateStore.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("merged");

      const usage = stateStore.totalUsage();
      expect(usage.inputTokens).toBe(50);

      stateStore.close();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
