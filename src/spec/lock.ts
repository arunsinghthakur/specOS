import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SpecLockSchema, type SpecLock, type SpecNode } from "./schema.js";

const LOCK_FILENAME = "spec.lock.json";

export async function readSpecLock(cwd: string = process.cwd()): Promise<SpecNode[]> {
  try {
    const raw = await readFile(path.join(cwd, LOCK_FILENAME), "utf-8");
    return SpecLockSchema.parse(JSON.parse(raw)).nodes;
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

/** Merges new nodes into the existing lock file by id (new nodes overwrite existing ones with the same id). */
export async function writeSpecLock(nodes: SpecNode[], cwd: string = process.cwd()): Promise<SpecLock> {
  const existing = await readSpecLock(cwd);
  const merged = new Map(existing.map((node) => [node.id, node]));
  for (const node of nodes) merged.set(node.id, node);

  const lock: SpecLock = SpecLockSchema.parse({
    version: 1,
    generatedAt: new Date().toISOString(),
    nodes: [...merged.values()],
  });

  await writeFile(path.join(cwd, LOCK_FILENAME), JSON.stringify(lock, null, 2) + "\n", "utf-8");
  return lock;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
