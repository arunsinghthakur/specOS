import type { AgentProvider } from "../engine/core/types.js";
import type { SpecNode } from "../spec/schema.js";
import { extractJson } from "../spec/agents/jsonExtract.js";
import { buildReadOnlyTools } from "./tools.js";
import { ReviewResultSchema, type ReviewResult } from "./schema.js";

const MAX_TURNS = 20;

function systemPrompt(testCommand: string | undefined): string {
  return [
    "You are a code reviewer. You cannot edit files — only read them and run commands.",
    "Check the implementation in the current working directory against the given acceptance criteria.",
    testCommand ? `Run \`${testCommand}\` via run_command to verify the test suite passes.` : "",
    'Respond with ONLY this JSON object, no prose: { "approved": boolean, "feedback": string }',
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runReviewer(
  provider: AgentProvider,
  node: SpecNode,
  worktreePath: string,
  testCommand: string | undefined,
): Promise<ReviewResult> {
  const agent = await provider.createAgent({
    role: "reviewer",
    systemPrompt: systemPrompt(testCommand),
    tools: buildReadOnlyTools(worktreePath),
    cwd: worktreePath,
    maxTurns: MAX_TURNS,
  });

  const result = await agent.sendMessage(
    `Review the implementation of: ${node.title}\n${node.description}\n\nAcceptance criteria:\n${node.acceptanceCriteria
      .map((c) => `- ${c}`)
      .join("\n")}`,
  );
  return ReviewResultSchema.parse(extractJson(result.finalMessage));
}
