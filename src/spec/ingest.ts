import type { AgentProvider } from "../engine/core/types.js";
import { normalizeSpec } from "./agents/normalizer.js";
import { validateSpec } from "./agents/validator.js";
import type { RawSpecInput } from "./rawInput.js";
import type { SpecNode } from "./schema.js";

const MAX_CLARIFYING_QUESTIONS = 3;

export interface IngestOptions {
  /** Prompts the user for an answer to one question. Omit to skip clarification and just warn on ambiguity. */
  askUser?: (question: string) => Promise<string>;
  warn?: (message: string) => void;
  /**
   * After clarification, ask one open-ended "anything else?" question and fold the answer in if
   * given. Meant for a single ad-hoc requirement (`--text`) where that's a natural, low-friction
   * way to enrich it — not for bulk ingestion (a Markdown file's sections, a JQL batch of Jira
   * issues), where repeating it per item would be exactly the kind of friction this is meant to avoid.
   */
  offerMoreDetails?: boolean;
}

/**
 * Normalizes raw spec text into a SpecNode, then — if the validator flags it as ambiguous and
 * `askUser` is provided — asks at most MAX_CLARIFYING_QUESTIONS high-level questions in a single
 * round, folds the answers back into the raw input, and re-normalizes once. Deliberately not a
 * multi-round interrogation: a handful of high-level questions plus (optionally) one open-ended
 * "anything else?" is the target experience, not an exhaustive back-and-forth. Source-agnostic —
 * the same function runs for a Markdown file, a Jira issue, or an ad-hoc --text requirement,
 * since all three arrive as a RawSpecInput.
 */
export async function ingestRawInput(
  provider: AgentProvider,
  raw: RawSpecInput,
  opts: IngestOptions = {},
): Promise<SpecNode> {
  const warn = opts.warn ?? (() => {});
  let current = raw;
  let node = await normalizeSpec(provider, current);

  const validation = await validateSpec(provider, node);
  const questions = validation.questions.slice(0, MAX_CLARIFYING_QUESTIONS);

  if (validation.ambiguous && questions.length > 0) {
    if (!opts.askUser) {
      warn("ambiguous — clarify before planning:");
      for (const question of questions) warn(`  - ${question}`);
    } else {
      warn("A few quick questions before writing the spec:");
      const answers: string[] = [];
      for (const question of questions) {
        answers.push(await opts.askUser(question));
      }
      current = { ...current, rawText: appendSection(current.rawText, "Clarifications", qaBlock(questions, answers)) };
      node = await normalizeSpec(provider, current);
    }
  }

  if (opts.askUser && opts.offerMoreDetails) {
    const more = (await opts.askUser("Anything else to add? (press Enter to finish)")).trim();
    if (more) {
      current = { ...current, rawText: appendSection(current.rawText, "Additional details", more) };
      node = await normalizeSpec(provider, current);
    }
  }

  return node;
}

function qaBlock(questions: string[], answers: string[]): string {
  return questions.map((q, i) => `Q: ${q}\nA: ${answers[i]}`).join("\n\n");
}

function appendSection(rawText: string, heading: string, body: string): string {
  return `${rawText}\n\n${heading}:\n${body}`;
}
