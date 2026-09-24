import { SpecNodeSchema, type SpecNode } from "./schema.js";

/** Serializes a SpecNode to a human-readable, git-diffable Markdown file with a small YAML-like frontmatter block. */
export function nodeToMarkdown(node: SpecNode): string {
  const frontmatter = [
    "---",
    `id: ${node.id}`,
    `priority: ${node.priority}`,
    node.epic ? `epic: ${node.epic}` : "",
    node.dependencies.length > 0 ? `dependencies:\n${node.dependencies.map((d) => `  - ${d}`).join("\n")}` : "",
    `source:\n  type: ${node.source.type}\n  ref: ${node.source.ref}`,
    "---",
  ].filter((line) => line.length > 0);

  const body = [
    `# ${node.title}`,
    "## Description",
    node.description,
    "## Acceptance criteria",
    node.acceptanceCriteria.map((c) => `- ${c}`).join("\n"),
    node.nonFunctionalReqs.length > 0
      ? `## Non-functional requirements\n\n${node.nonFunctionalReqs.map((c) => `- ${c}`).join("\n")}`
      : "",
  ].filter((section) => section.length > 0);

  return `${frontmatter.join("\n")}\n\n${body.join("\n\n")}\n`;
}

/** Parses a Markdown file written by `nodeToMarkdown` (or a compatible hand-edit) back into a SpecNode. */
export function markdownToNode(raw: string): SpecNode {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("Spec Markdown file must start with a --- frontmatter block.");
  }
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) {
    throw new Error("Spec Markdown file's frontmatter block is never closed with a second ---.");
  }

  const front = parseFrontmatter(lines.slice(1, closingIndex));
  const body = parseBody(lines.slice(closingIndex + 1).join("\n"));

  return SpecNodeSchema.parse({
    id: front.id,
    title: body.title,
    description: body.description,
    acceptanceCriteria: body.acceptanceCriteria,
    dependencies: front.dependencies,
    priority: front.priority,
    epic: front.epic,
    nonFunctionalReqs: body.nonFunctionalReqs,
    source: front.source,
  });
}

interface Frontmatter {
  id?: string;
  priority?: string;
  epic?: string;
  dependencies: string[];
  source?: { type: string; ref: string };
}

function parseFrontmatter(lines: string[]): Frontmatter {
  const front: Frontmatter = { dependencies: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idMatch = /^id:\s*(.+)$/.exec(line);
    const priorityMatch = /^priority:\s*(.+)$/.exec(line);
    const epicMatch = /^epic:\s*(.+)$/.exec(line);
    if (idMatch) {
      front.id = idMatch[1].trim();
    } else if (priorityMatch) {
      front.priority = priorityMatch[1].trim();
    } else if (epicMatch) {
      front.epic = epicMatch[1].trim();
    } else if (/^dependencies:\s*$/.test(line)) {
      while (i + 1 < lines.length && /^\s*-\s*(.+)$/.test(lines[i + 1])) {
        i++;
        front.dependencies.push(/^\s*-\s*(.+)$/.exec(lines[i])![1].trim());
      }
    } else if (/^source:\s*$/.test(line)) {
      const typeLine = /^\s*type:\s*(.+)$/.exec(lines[i + 1] ?? "");
      const refLine = /^\s*ref:\s*(.+)$/.exec(lines[i + 2] ?? "");
      if (typeLine && refLine) {
        front.source = { type: typeLine[1].trim(), ref: refLine[1].trim() };
        i += 2;
      }
    }
  }
  return front;
}

interface Body {
  title?: string;
  description: string;
  acceptanceCriteria: string[];
  nonFunctionalReqs: string[];
}

function parseBody(text: string): Body {
  const sections = text.split(/\n(?=##\s+)/);
  const body: Body = { description: "", acceptanceCriteria: [], nonFunctionalReqs: [] };

  const titleMatch = /^\s*\n?#\s+(.+)$/m.exec(sections[0] ?? "");
  if (titleMatch) body.title = titleMatch[1].trim();

  for (const section of sections.slice(1)) {
    const headerMatch = /^##\s+(.+?)\s*\n([\s\S]*)$/.exec(section.trim());
    if (!headerMatch) continue;
    const heading = headerMatch[1].trim().toLowerCase();
    const content = headerMatch[2].trim();
    const bullets = () =>
      content
        .split(/\r?\n/)
        .filter((line) => /^-\s+/.test(line))
        .map((line) => line.replace(/^-\s+/, "").trim());

    if (heading === "description") body.description = content;
    else if (heading === "acceptance criteria") body.acceptanceCriteria = bullets();
    else if (heading === "non-functional requirements") body.nonFunctionalReqs = bullets();
  }

  return body;
}
