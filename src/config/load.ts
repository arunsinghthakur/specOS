import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema, type Config } from "./schema.js";

const CONFIG_FILENAME = "specos.config.json";

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  try {
    const raw = await readFile(configPath, "utf-8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (isNotFound(err)) {
      return ConfigSchema.parse({});
    }
    throw new Error(`Failed to load ${CONFIG_FILENAME}: ${(err as Error).message}`);
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
