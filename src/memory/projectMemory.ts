import { readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_MEMORY_PATH = ".specos/memory/project.md";

/** Small, persistent, cacheable context (architecture decisions, conventions) injected into every agent. */
export async function loadProjectMemory(projectRoot: string): Promise<string> {
  try {
    return await readFile(path.join(projectRoot, PROJECT_MEMORY_PATH), "utf-8");
  } catch {
    return "";
  }
}
