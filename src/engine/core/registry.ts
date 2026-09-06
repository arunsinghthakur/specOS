import type { AgentProvider } from "./types.js";
import { ClaudeAgentProvider } from "../providers/claude/provider.js";
import type { Config } from "../../config/schema.js";

export function createProvider(config: Config): AgentProvider {
  switch (config.provider) {
    case "claude":
      return new ClaudeAgentProvider();
    default:
      throw new Error(`Unknown agent provider: ${config.provider}`);
  }
}
