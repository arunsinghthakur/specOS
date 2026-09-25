import type { AgentProvider } from "../../engine/core/types.js";
import { ValidationResultSchema, type SpecNode, type ValidationResult } from "../schema.js";
import { extractJson } from "./jsonExtract.js";

const SYSTEM_PROMPT = `You review a normalized feature spec for ambiguity or missing information that would
block an engineer from implementing it (unclear acceptance criteria, missing inputs/outputs, undefined
edge cases, contradictory requirements). Respond with ONLY this JSON object, no prose:
{ "ambiguous": boolean, "questions": string[] }
"questions" should be empty when "ambiguous" is false. A human answers these interactively, one at a
time, so ask for AT MOST the 3 most important, highest-level things you'd need to know before an
engineer could start — not an exhaustive checklist. Merge related concerns into one question rather
than splitting them (e.g. one question covering both persistence and auth, not two separate ones).
Skip anything a reasonable engineer would just make a sensible default choice on.`;

/** Runs a normalized spec node through a validator agent to surface clarifying questions before planning. */
export async function validateSpec(provider: AgentProvider, node: SpecNode): Promise<ValidationResult> {
  const agent = await provider.createAgent({
    role: "validator",
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    cwd: process.cwd(),
    maxTurns: 1,
  });

  const result = await agent.sendMessage(JSON.stringify(node, null, 2));
  const parsed = extractJson(result.finalMessage);
  return ValidationResultSchema.parse(parsed);
}
