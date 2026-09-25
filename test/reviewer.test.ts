import { describe, expect, it } from "vitest";
import { runReviewer } from "../src/swarm/reviewer.js";
import type { AgentHandle, AgentProvider, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { SpecNode } from "../src/spec/schema.js";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const node: SpecNode = {
  id: "login",
  title: "Login",
  description: "Add a login form.",
  acceptanceCriteria: ["Valid credentials log the user in"],
  dependencies: [],
  priority: "medium",
  nonFunctionalReqs: [],
  source: { type: "text", ref: "spec.txt" },
};

/** Returns `responses[call]` for each successive sendMessage call, repeating the last one past the end. */
function fakeProvider(responses: string[]): AgentProvider {
  let call = 0;
  return {
    name: "fake",
    async createAgent(_options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: "reviewer-fake",
        role: "reviewer",
        async sendMessage() {
          const response = responses[Math.min(call, responses.length - 1)];
          call += 1;
          return { finalMessage: response, transcript: [], usage: ZERO_USAGE };
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

describe("runReviewer", () => {
  it("returns the parsed verdict directly when the first response is valid JSON", async () => {
    const provider = fakeProvider(['{"approved": true, "feedback": "looks good"}']);
    const result = await runReviewer(provider, node, "/repo", undefined);
    expect(result).toEqual({ approved: true, feedback: "looks good" });
  });

  it("nudges once and recovers when the model runs out of room mid-review without emitting JSON", async () => {
    const provider = fakeProvider([
      "Good front-end structure. Let's check styles.css next, then run the test suite.",
      '{"approved": false, "feedback": "Missing a test for invalid credentials."}',
    ]);
    const result = await runReviewer(provider, node, "/repo", "npm test");
    expect(result).toEqual({ approved: false, feedback: "Missing a test for invalid credentials." });
  });

  it("throws with the raw text when even the nudged response has no JSON", async () => {
    const provider = fakeProvider(["Still thinking about this one.", "Still not sure, let me look again."]);
    await expect(runReviewer(provider, node, "/repo", undefined)).rejects.toThrow(/did not return JSON/);
  });
});
