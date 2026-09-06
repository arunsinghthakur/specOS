/**
 * Provider-agnostic agent engine contract. Every LLM backend (Claude Agent SDK today,
 * others later) implements AgentProvider so orchestrator/harness/swarm code never
 * depends on a specific vendor SDK.
 */

export type AgentRole = "normalizer" | "validator" | "worker" | "reviewer" | "conflict-resolver" | "summarizer";

export type ToolFieldType = "string" | "number" | "boolean";

export interface ToolDefinition {
  name: string;
  description: string;
  /** Minimal, provider-agnostic field-type map — each provider adapter converts this into its own schema format. */
  inputSchema: Record<string, ToolFieldType>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentRunResult {
  finalMessage: string;
  transcript: AgentMessage[];
  usage: TokenUsage;
}

export interface AgentHandle {
  id: string;
  role: AgentRole;
  sendMessage(content: string): Promise<AgentRunResult>;
  getUsage(): TokenUsage;
}

export interface CreateAgentOptions {
  role: AgentRole;
  systemPrompt: string;
  tools: ToolDefinition[];
  /** Working directory the agent's filesystem tools are sandboxed to (e.g. a worktree path). */
  cwd: string;
  maxTurns?: number;
}

export interface AgentProvider {
  readonly name: string;
  createAgent(options: CreateAgentOptions): Promise<AgentHandle>;
}
