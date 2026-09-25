import { slugify } from "../slug.js";
import type { RawSpecInput } from "../rawInput.js";

/** Wraps a single ad-hoc plain-text requirement (e.g. from `specos spec add --text "..."`) as one RawSpecInput. */
export function parseTextSpec(text: string, id?: string): RawSpecInput {
  const rawText = text.trim();
  if (!rawText) {
    throw new Error("--text requirement is empty.");
  }

  const fallbackId = slugify(rawText.split(/\s+/).slice(0, 6).join(" "));
  const resolvedId = (id ? slugify(id) : fallbackId) || "requirement";

  return {
    id: resolvedId,
    sourceType: "text",
    sourceRef: "cli:--text",
    rawText,
  };
}
