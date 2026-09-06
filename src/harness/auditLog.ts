import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface AuditEntry {
  timestamp: string;
  taskId: string;
  event: string;
  detail?: Record<string, unknown>;
}

export class AuditLog {
  private readonly filePath: string;

  constructor(projectRoot: string) {
    this.filePath = path.join(projectRoot, ".specos", "audit.jsonl");
  }

  async record(taskId: string, event: string, detail?: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const entry: AuditEntry = { timestamp: new Date().toISOString(), taskId, event, detail };
    await appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
  }
}
