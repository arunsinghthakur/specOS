import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "../engine/core/types.js";

const TRANSCRIPTS_DIR = ".specos/transcripts";

/** Persists a full agent transcript to disk — never re-loaded into another agent's context, kept only for audit/debugging. */
export async function archiveTranscript(projectRoot: string, taskId: string, transcript: AgentMessage[]): Promise<void> {
  const dir = path.join(projectRoot, TRANSCRIPTS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${taskId}.json`), JSON.stringify(transcript, null, 2) + "\n", "utf-8");
}
