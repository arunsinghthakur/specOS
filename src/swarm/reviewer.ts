import type { AgentActivityEvent, AgentProvider } from "../engine/core/types.js";
import type { SpecNode } from "../spec/schema.js";
import { extractJson } from "../spec/agents/jsonExtract.js";
import { buildReadOnlyTools } from "./tools.js";
import { ReviewResultSchema, type ReviewResult } from "./schema.js";

const MAX_TURNS = 40;

function systemPrompt(testCommand: string | undefined): string {
  return [
    "You are a code reviewer. You cannot edit files — only read them and run commands.",
    "Check the implementation in the current working directory against the given acceptance criteria.",
    testCommand ? `Run \`${testCommand}\` via run_command to verify the test suite passes.` : "",
    "Be efficient: read only the files relevant to the acceptance criteria, then respond — don't explore the",
    "whole codebase file-by-file for its own sake, and don't keep investigating once you have enough to decide.",
    'Respond with ONLY this JSON object, no prose: { "approved": boolean, "feedback": string }',
  ]
    .filter(Boolean)
    .join("\n");
}

function tryParseReview(text: string): ReviewResult | null {
  try {
    return ReviewResultSchema.parse(extractJson(text));
  } catch {
    return null;
  }
}

export async function runReviewer(
  provider: AgentProvider,
  node: SpecNode,
  worktreePath: string,
  testCommand: string | undefined,
  onActivity?: (event: AgentActivityEvent) => void,
): Promise<ReviewResult> {
  const agent = await provider.createAgent({
    role: "reviewer",
    systemPrompt: systemPrompt(testCommand),
    tools: buildReadOnlyTools(worktreePath),
    cwd: worktreePath,
    maxTurns: MAX_TURNS,
    onActivity,
  });

  const result = await agent.sendMessage(
    `Review the implementation of: ${node.title}\n${node.description}\n\nAcceptance criteria:\n${node.acceptanceCriteria
      .map((c) => `- ${c}`)
      .join("\n")}`,
  );
  const parsed = tryParseReview(result.finalMessage);
  if (parsed) return parsed;

  // The model sometimes runs out of room mid-review (reading files, running tests) without ever
  // emitting its final verdict — one direct nudge recovers that far more often than failing the
  // whole task and leaving a human to dig through logs before retrying it.
  const nudged = await agent.sendMessage(
    'Respond now with ONLY the required JSON object, based on everything you have already reviewed: ' +
      '{ "approved": boolean, "feedback": string }',
  );
  return ReviewResultSchema.parse(extractJson(nudged.finalMessage));
}
