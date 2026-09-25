import type { AgentActivityEvent, AgentProvider, AgentRunResult } from "../engine/core/types.js";
import type { SpecNode } from "../spec/schema.js";
import { buildWorkerTools } from "./tools.js";

const MAX_TURNS = 40;

/** Runs a worker agent to completion for one task, sandboxed to its own git worktree. */
export async function runWorker(
  provider: AgentProvider,
  node: SpecNode,
  worktreePath: string,
  systemPrompt: string,
  onActivity?: (event: AgentActivityEvent) => void,
): Promise<AgentRunResult> {
  const agent = await provider.createAgent({
    role: "worker",
    systemPrompt,
    tools: buildWorkerTools(worktreePath),
    cwd: worktreePath,
    maxTurns: MAX_TURNS,
    onActivity,
  });
  return agent.sendMessage(`Begin implementing: ${node.title}`);
}
