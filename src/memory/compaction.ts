import type { AgentProvider, AgentRunResult } from "../engine/core/types.js";
import type { SpecNode } from "../spec/schema.js";
import { extractDoneSummary, hasDoneMarker } from "./taskMemory.js";
import { summarizeTranscript } from "./agents/summarizer.js";

/**
 * Compacts a completed worker's transcript into the one-line summary stored in swarm memory.
 * Cheap path: reuse the worker's own 'DONE:' line — zero extra model calls, the common case.
 * Fallback: a dedicated summarizer call, spent only when the worker didn't end cleanly.
 */
export async function compactWorkerResult(provider: AgentProvider, node: SpecNode, result: AgentRunResult): Promise<string> {
  if (hasDoneMarker(result.finalMessage)) {
    return extractDoneSummary(result.finalMessage);
  }
  return summarizeTranscript(provider, node, result.transcript);
}
