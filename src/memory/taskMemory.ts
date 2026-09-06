import type { SpecNode } from "../spec/schema.js";
import type { SwarmMemoryRecord } from "./swarmMemory.js";

/**
 * Builds a worker's system prompt from task-scoped context only: the spec node it owns,
 * project-wide conventions, and short summaries of already-completed tasks — never the
 * full spec or full codebase, which is the primary token-optimization lever.
 */
export function buildWorkerSystemPrompt(
  node: SpecNode,
  projectMemory: string,
  completedSummaries: SwarmMemoryRecord[],
): string {
  const sections = [
    "You are an autonomous coding agent. Implement exactly one task, in full, inside the current working directory (an isolated git worktree). Write code and tests using the read_file/write_file/list_dir/run_command tools.",
    projectMemory ? `Project conventions:\n${projectMemory}` : "",
    completedSummaries.length > 0
      ? `Already completed by other agents (do not redo, keep contracts compatible):\n${completedSummaries
          .map((s) => `- [${s.taskId}] ${s.summary}`)
          .join("\n")}`
      : "",
    `Task: ${node.title}\n${node.description}`,
    node.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n${node.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
      : "",
    node.nonFunctionalReqs.length > 0
      ? `Non-functional requirements:\n${node.nonFunctionalReqs.map((c) => `- ${c}`).join("\n")}`
      : "",
    "When the task is fully implemented and tests pass, reply with a final message starting with 'DONE:' followed by a one-sentence summary of what you built and where (files/functions), so other agents can reuse that context without reading your full transcript.",
  ];
  return sections.filter((section) => section.length > 0).join("\n\n");
}

const DONE_MARKER_RE = /DONE:\s*(.*)/is;

export function hasDoneMarker(finalMessage: string): boolean {
  return DONE_MARKER_RE.test(finalMessage);
}

export function extractDoneSummary(finalMessage: string): string {
  const match = DONE_MARKER_RE.exec(finalMessage);
  return match ? match[1].trim() : finalMessage.slice(0, 200).trim();
}
