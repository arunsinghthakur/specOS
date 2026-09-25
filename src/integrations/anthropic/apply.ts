import { loadAnthropicApiKey } from "./credentials.js";

/**
 * Sets ANTHROPIC_API_KEY from the OS keychain if the environment doesn't already have one —
 * an explicit env var (or a working `claude` CLI login, which needs no key at all) always wins,
 * so this only ever provides a fallback set via `specos auth anthropic` / `specos setup`.
 */
export async function applyStoredAnthropicKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  const key = await loadAnthropicApiKey();
  if (key) process.env.ANTHROPIC_API_KEY = key;
}
