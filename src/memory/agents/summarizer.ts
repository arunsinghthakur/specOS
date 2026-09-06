import type { AgentMessage, AgentProvider } from "../../engine/core/types.js";
import type { SpecNode } from "../../spec/schema.js";

const SYSTEM_PROMPT = `You compress an agent's work transcript into exactly one sentence describing what was
built or changed and where (files/functions), so other agents can reuse that context without reading the
full transcript. Respond with ONLY that sentence — no prose, no quotes, no markdown.`;

const MAX_TRANSCRIPT_CHARS = 20_000;

/**
 * Compaction fallback for when a worker didn't end with a clean 'DONE:' summary — the cheap path
 * (extractDoneSummary) covers the common case with zero extra model calls; this one-shot call is
 * only spent when that heuristic fails, keeping the token-optimization goal intact.
 */
export async function summarizeTranscript(provider: AgentProvider, node: SpecNode, transcript: AgentMessage[]): Promise<string> {
  const agent = await provider.createAgent({
    role: "summarizer",
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    cwd: process.cwd(),
    maxTurns: 1,
  });

  const transcriptText = transcript
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(-MAX_TRANSCRIPT_CHARS);

  const result = await agent.sendMessage(`Task: ${node.title}\n\nTranscript:\n${transcriptText}`);
  return result.finalMessage.trim();
}
