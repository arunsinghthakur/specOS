import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpecNode } from "./schema.js";
import { nodeToMarkdown, markdownToNode } from "./specMarkdown.js";

const SPECS_DIR = "specs";

function nodePath(cwd: string, id: string): string {
  return path.join(cwd, SPECS_DIR, `${id}.md`);
}

/** Reads every requirement back from its own `specs/<id>.md` file — the specs/ directory is the source of truth. */
export async function readSpecNodes(cwd: string = process.cwd()): Promise<SpecNode[]> {
  let entries: string[];
  try {
    entries = await readdir(path.join(cwd, SPECS_DIR));
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }

  const nodes: SpecNode[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    const raw = await readFile(path.join(cwd, SPECS_DIR, entry), "utf-8");
    nodes.push(markdownToNode(raw));
  }
  return nodes;
}

/**
 * Writes one Markdown file per node under `specs/`, one requirement per file so each gets its own
 * git history. Skips a node whose serialized content is byte-identical to what's already on disk,
 * so re-running ingestion on unchanged requirements doesn't touch their file (and doesn't show up
 * in a subsequent git diff/commit). Returns the paths that actually changed.
 */
export async function writeSpecNodes(nodes: SpecNode[], cwd: string = process.cwd()): Promise<string[]> {
  await mkdir(path.join(cwd, SPECS_DIR), { recursive: true });

  const changed: string[] = [];
  for (const node of nodes) {
    const filePath = nodePath(cwd, node.id);
    const content = nodeToMarkdown(node);
    const previous = await readFile(filePath, "utf-8").catch(() => null);
    if (previous === content) continue;
    await writeFile(filePath, content, "utf-8");
    changed.push(filePath);
  }
  return changed;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
