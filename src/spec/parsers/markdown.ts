import path from "node:path";
import type { RawSpecInput } from "../rawInput.js";
import { slugify } from "../slug.js";

const HEADING_RE = /^#{1,2}\s+(.*)$/;

/**
 * Splits a Markdown/text spec file into one RawSpecInput per top-level (#/##) section.
 * A file with no headings is treated as a single section.
 */
export function parseMarkdownSpec(filePath: string, content: string): RawSpecInput[] {
  if (!content.trim()) return [];

  const lines = content.split(/\r?\n/);
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      current = { heading: match[1].trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      current = { heading: path.basename(filePath), body: [line] };
      sections.push(current);
    }
  }

  if (sections.length === 0) {
    return [];
  }

  const baseId = slugify(path.basename(filePath, path.extname(filePath)));
  const sourceType: RawSpecInput["sourceType"] = path.extname(filePath) === ".md" ? "markdown" : "text";

  const inputs: RawSpecInput[] = [];
  sections.forEach((section, index) => {
    const rawText = section.body.join("\n").trim();
    if (!rawText && !section.heading) return;
    const slug = slugify(section.heading) || `section-${index + 1}`;
    inputs.push({
      id: `${baseId}-${slug}`,
      sourceType,
      sourceRef: `${filePath}#${section.heading || slug}`,
      rawText: `${section.heading}\n\n${rawText}`.trim(),
    });
  });
  return inputs.filter((input) => input.rawText.length > 0);
}
