import { describe, expect, it } from "vitest";
import { compactWorkerResult } from "../src/memory/compaction.js";
import type { AgentHandle, AgentProvider, AgentRunResult, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { SpecNode } from "../src/spec/schema.js";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const node: SpecNode = {
  id: "task-1",
  title: "Login",
  description: "desc",
  acceptanceCriteria: [],
  dependencies: [],
  priority: "medium",
  nonFunctionalReqs: [],
  source: { type: "text", ref: "x" },
};

function providerReturning(summarizerReply: string): AgentProvider {
  return {
    name: "fake",
    async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: "fake",
        role: options.role,
        async sendMessage() {
          return { finalMessage: summarizerReply, transcript: [], usage: ZERO_USAGE };
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

describe("compactWorkerResult", () => {
  it("uses the worker's own DONE: summary without calling the summarizer agent", async () => {
    let summarizerCalled = false;
    const provider: AgentProvider = {
      name: "fake",
      async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
        summarizerCalled = summarizerCalled || options.role === "summarizer";
        return {
          id: "fake",
          role: options.role,
          async sendMessage() {
            return { finalMessage: "should not be called", transcript: [], usage: ZERO_USAGE };
          },
          getUsage: () => ZERO_USAGE,
        };
      },
    };

    const result: AgentRunResult = {
      finalMessage: "some reasoning\nDONE: added login form in src/login.ts",
      transcript: [],
      usage: ZERO_USAGE,
    };

    const summary = await compactWorkerResult(provider, node, result);
    expect(summary).toBe("added login form in src/login.ts");
    expect(summarizerCalled).toBe(false);
  });

  it("falls back to the summarizer agent when there is no DONE: marker", async () => {
    const provider = providerReturning("Added a login form in src/login.ts with validation.");
    const result: AgentRunResult = {
      finalMessage: "ran out of turns without finishing cleanly",
      transcript: [{ role: "assistant", content: "did some stuff" }],
      usage: ZERO_USAGE,
    };

    const summary = await compactWorkerResult(provider, node, result);
    expect(summary).toBe("Added a login form in src/login.ts with validation.");
  });
});
