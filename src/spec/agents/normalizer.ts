import type { AgentProvider } from "../../engine/core/types.js";
import { NormalizedSpecSchema, type NormalizedSpec, type SpecNode } from "../schema.js";
import type { RawSpecInput } from "../rawInput.js";
import { extractJson } from "./jsonExtract.js";

const SYSTEM_PROMPT = `You convert a raw feature/ticket description into a strict JSON object with this shape:
{
  "title": string,
  "description": string,
  "acceptanceCriteria": string[],
  "dependencies": string[],   // ids/keys of other tickets this depends on, if mentioned
  "priority": "low" | "medium" | "high" | "critical",
  "epic": string | undefined,
  "nonFunctionalReqs": string[]
}
Respond with ONLY the JSON object, no prose, no markdown fences.`;

/** Runs the raw spec text through a normalizer agent and validates the result against NormalizedSpecSchema. */
export async function normalizeSpec(provider: AgentProvider, input: RawSpecInput): Promise<SpecNode> {
  const agent = await provider.createAgent({
    role: "normalizer",
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    cwd: process.cwd(),
    maxTurns: 1,
  });

  const result = await agent.sendMessage(input.rawText);
  const parsed = extractJson(result.finalMessage);
  const normalized: NormalizedSpec = NormalizedSpecSchema.parse(parsed);

  return {
    ...normalized,
    id: input.id,
    source: { type: input.sourceType, ref: input.sourceRef },
  };
}
