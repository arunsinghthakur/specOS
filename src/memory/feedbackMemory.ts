import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface FeedbackMemoryRecord {
  taskId: string;
  feedback: string;
  timestamp: string;
}

const FEEDBACK_MEMORY_PATH = ".specos/memory/feedback.jsonl";

/**
 * Append-only log of reviewer rejection feedback, keyed by task. Read back into the worker's
 * prompt on retry so a task that was previously blocked doesn't start cold with no memory of
 * why the reviewer rejected it last time.
 */
export class FeedbackMemory {
  private readonly filePath: string;

  constructor(projectRoot: string) {
    this.filePath = path.join(projectRoot, FEEDBACK_MEMORY_PATH);
  }

  async append(record: FeedbackMemoryRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf-8");
  }

  async forTask(taskId: string): Promise<FeedbackMemoryRecord[]> {
    return (await this.all()).filter((record) => record.taskId === taskId);
  }

  async all(): Promise<FeedbackMemoryRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as FeedbackMemoryRecord);
    } catch {
      return [];
    }
  }
}
