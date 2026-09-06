import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface SwarmMemoryRecord {
  taskId: string;
  summary: string;
  timestamp: string;
}

const SWARM_MEMORY_PATH = ".specos/memory/swarm.jsonl";

/**
 * Append-only log of short completed-task summaries, shared across all workers so later tasks
 * don't duplicate work or break earlier contracts — without carrying full transcripts in context.
 */
export class SwarmMemory {
  private readonly filePath: string;

  constructor(projectRoot: string) {
    this.filePath = path.join(projectRoot, SWARM_MEMORY_PATH);
  }

  async append(record: SwarmMemoryRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf-8");
  }

  async all(): Promise<SwarmMemoryRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as SwarmMemoryRecord);
    } catch {
      return [];
    }
  }
}
