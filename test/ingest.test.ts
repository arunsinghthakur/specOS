import { describe, expect, it } from "vitest";
import { ingestRawInput } from "../src/spec/ingest.js";
import type { AgentHandle, AgentProvider, CreateAgentOptions, TokenUsage } from "../src/engine/core/types.js";
import type { RawSpecInput } from "../src/spec/rawInput.js";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const NORMALIZED_JSON = JSON.stringify({
  title: "Login",
  description: "Add a login form.",
  acceptanceCriteria: ["User can submit valid credentials"],
  dependencies: [],
  priority: "medium",
  nonFunctionalReqs: [],
});

/** validateSpec is only ever called once per ingestRawInput call now, so one canned response is enough. */
function fakeProvider(validatorResponse: string, normalizerCalls: string[]): AgentProvider {
  return {
    name: "fake",
    async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
      return {
        id: `${options.role}-fake`,
        role: options.role,
        async sendMessage(content: string) {
          if (options.role === "normalizer") {
            normalizerCalls.push(content);
            return { finalMessage: NORMALIZED_JSON, transcript: [], usage: ZERO_USAGE };
          }
          if (options.role === "validator") {
            return { finalMessage: validatorResponse, transcript: [], usage: ZERO_USAGE };
          }
          throw new Error(`unexpected role ${options.role}`);
        },
        getUsage: () => ZERO_USAGE,
      };
    },
  };
}

const RAW: RawSpecInput = { id: "task-1", sourceType: "text", sourceRef: "spec.txt", rawText: "Add login." };

const CLEAR = JSON.stringify({ ambiguous: false, questions: [] });

describe("ingestRawInput", () => {
  it("asks the clarifying questions once and folds the answers into a re-normalized node", async () => {
    const normalizerCalls: string[] = [];
    const ambiguous = JSON.stringify({
      ambiguous: true,
      questions: ["What auth provider?", "Should sessions persist across restarts?"],
    });
    const provider = fakeProvider(ambiguous, normalizerCalls);
    const askedQuestions: string[] = [];

    const node = await ingestRawInput(provider, RAW, {
      askUser: async (question) => {
        askedQuestions.push(question);
        return question.includes("auth") ? "OAuth via Google" : "Yes";
      },
    });

    expect(askedQuestions).toEqual(["What auth provider?", "Should sessions persist across restarts?"]);
    expect(normalizerCalls).toHaveLength(2);
    expect(normalizerCalls[1]).toContain("Clarifications:");
    expect(normalizerCalls[1]).toContain("Q: What auth provider?");
    expect(normalizerCalls[1]).toContain("A: OAuth via Google");
    expect(node.title).toBe("Login");
  });

  it("caps clarifying questions at 3, even if the validator returns more", async () => {
    const normalizerCalls: string[] = [];
    const manyQuestions = JSON.stringify({
      ambiguous: true,
      questions: ["Q1", "Q2", "Q3", "Q4", "Q5"],
    });
    const provider = fakeProvider(manyQuestions, normalizerCalls);
    const askedQuestions: string[] = [];

    await ingestRawInput(provider, RAW, {
      askUser: async (question) => {
        askedQuestions.push(question);
        return "answer";
      },
    });

    expect(askedQuestions).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("skips clarification and just warns (capped) when no askUser is provided", async () => {
    const normalizerCalls: string[] = [];
    const manyQuestions = JSON.stringify({ ambiguous: true, questions: ["Q1", "Q2", "Q3", "Q4"] });
    const provider = fakeProvider(manyQuestions, normalizerCalls);
    const warnings: string[] = [];

    const node = await ingestRawInput(provider, RAW, { warn: (m) => warnings.push(m) });

    expect(normalizerCalls).toHaveLength(1); // no re-normalization — clarification never happened
    expect(node.title).toBe("Login");
    expect(warnings.some((w) => w.includes("Q1"))).toBe(true);
    expect(warnings.some((w) => w.includes("Q4"))).toBe(false); // capped at 3
  });

  it("returns immediately when the validator finds nothing ambiguous", async () => {
    const normalizerCalls: string[] = [];
    const provider = fakeProvider(CLEAR, normalizerCalls);

    const node = await ingestRawInput(provider, RAW, {
      askUser: async () => {
        throw new Error("should never be called");
      },
    });

    expect(normalizerCalls).toHaveLength(1);
    expect(node.title).toBe("Login");
  });

  describe("offerMoreDetails", () => {
    it("asks one open-ended question and folds in a non-empty answer", async () => {
      const normalizerCalls: string[] = [];
      const provider = fakeProvider(CLEAR, normalizerCalls);

      await ingestRawInput(provider, RAW, {
        askUser: async () => "Also needs a dark mode toggle",
        offerMoreDetails: true,
      });

      expect(normalizerCalls).toHaveLength(2);
      expect(normalizerCalls[1]).toContain("Additional details:");
      expect(normalizerCalls[1]).toContain("Also needs a dark mode toggle");
    });

    it("doesn't re-normalize when the answer is left blank", async () => {
      const normalizerCalls: string[] = [];
      const provider = fakeProvider(CLEAR, normalizerCalls);

      await ingestRawInput(provider, RAW, { askUser: async () => "   ", offerMoreDetails: true });

      expect(normalizerCalls).toHaveLength(1);
    });

    it("is never asked when offerMoreDetails isn't set", async () => {
      const normalizerCalls: string[] = [];
      const provider = fakeProvider(CLEAR, normalizerCalls);

      await ingestRawInput(provider, RAW, {
        askUser: async () => {
          throw new Error("should never be called");
        },
      });

      expect(normalizerCalls).toHaveLength(1);
    });
  });
});
