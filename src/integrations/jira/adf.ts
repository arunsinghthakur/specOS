/**
 * Minimal Atlassian Document Format -> plain text flattener. Jira Cloud REST v3
 * returns rich-text fields (description, comments) as ADF trees; we only need
 * their text content for spec ingestion, not full fidelity rendering.
 */
export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

export function adfToPlainText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  const lines: string[] = [];
  walk(node, lines);
  return lines.join("\n").trim();
}

function walk(node: AdfNode, lines: string[]): void {
  if (node.type === "text" && node.text) {
    appendInline(lines, node.text);
    return;
  }
  for (const child of node.content ?? []) {
    walk(child, lines);
  }
  if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") {
    lines.push("");
  }
}

function appendInline(lines: string[], text: string): void {
  if (lines.length === 0) lines.push("");
  lines[lines.length - 1] += text;
}
