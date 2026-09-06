import { describe, expect, it } from "vitest";
import { normalizeSpec } from "../src/spec/agents/normalizer.js";
import { validateSpec } from "../src/spec/agents/validator.js";
import type { AgentHandle, AgentProvider, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { RawSpecInput } from "../src/spec/rawInput.js";
import type { SpecNode } from "../src/spec/schema.js";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeProvider(response: string): AgentProvider {
  return {
    name: "fake",
    async createAgent(_options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: "fake-1",
        role: _options.role,
        async sendMessage(content: string) {
          return { finalMessage: response, transcript: [{ role: "user", content }], usage: ZERO_USAGE };
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

describe("normalizeSpec", () => {
  it("parses the agent's JSON response into a SpecNode", async () => {
    const raw: RawSpecInput = { id: "task-1", sourceType: "text", sourceRef: "spec.txt", rawText: "Add login." };
    const provider = fakeProvider(
      JSON.stringify({
        title: "Login",
        description: "Add a login form.",
        acceptanceCriteria: ["User can submit valid credentials"],
        dependencies: [],
        priority: "high",
        nonFunctionalReqs: [],
      }),
    );

    const node = await normalizeSpec(provider, raw);
    expect(node.id).toBe("task-1");
    expect(node.title).toBe("Login");
    expect(node.priority).toBe("high");
    expect(node.source).toEqual({ type: "text", ref: "spec.txt" });
  });

  it("throws when the agent response has no JSON object", async () => {
    const raw: RawSpecInput = { id: "task-2", sourceType: "text", sourceRef: "spec.txt", rawText: "x" };
    const provider = fakeProvider("sorry, I can't do that");
    await expect(normalizeSpec(provider, raw)).rejects.toThrow(/did not return JSON/);
  });
});

describe("validateSpec", () => {
  it("surfaces clarifying questions when the agent flags ambiguity", async () => {
    const node: SpecNode = {
      id: "task-1",
      title: "Login",
      description: "Add a login form.",
      acceptanceCriteria: [],
      dependencies: [],
      priority: "medium",
      nonFunctionalReqs: [],
      source: { type: "text", ref: "spec.txt" },
    };
    const provider = fakeProvider(JSON.stringify({ ambiguous: true, questions: ["What auth provider?"] }));

    const result = await validateSpec(provider, node);
    expect(result.ambiguous).toBe(true);
    expect(result.questions).toEqual(["What auth provider?"]);
  });
});
