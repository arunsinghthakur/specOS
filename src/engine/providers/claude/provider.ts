import { query, type Options, type PermissionMode, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentHandle,
  AgentMessage,
  AgentProvider,
  AgentRole,
  AgentRunResult,
  CreateAgentOptions,
  TokenUsage,
} from "../../core/types.js";
import { AsyncQueue } from "./asyncQueue.js";
import { buildMcpServer } from "./toolBridge.js";

const ROLE_PERMISSION_MODE: Record<AgentRole, PermissionMode> = {
  normalizer: "default",
  validator: "default",
  worker: "acceptEdits",
  reviewer: "plan",
  "conflict-resolver": "acceptEdits",
  summarizer: "default",
};

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

class ClaudeAgentHandle implements AgentHandle {
  readonly id: string;
  readonly role: AgentRole;
  private readonly input: AsyncQueue<SDKUserMessage>;
  private readonly session: AsyncGenerator<any, void>;
  private readonly transcript: AgentMessage[] = [];
  private usage: TokenUsage = zeroUsage();
  private turn = 0;

  constructor(id: string, role: AgentRole, input: AsyncQueue<SDKUserMessage>, session: AsyncGenerator<any, void>) {
    this.id = id;
    this.role = role;
    this.input = input;
    this.session = session;
  }

  async sendMessage(content: string): Promise<AgentRunResult> {
    this.transcript.push({ role: "user", content });
    this.turn += 1;
    this.input.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    } as SDKUserMessage);

    const assistantChunks: string[] = [];
    for await (const message of this.session) {
      if (message.type === "assistant") {
        for (const block of message.message?.content ?? []) {
          if (block.type === "text") assistantChunks.push(block.text);
        }
      } else if (message.type === "result") {
        this.applyUsage(message.modelUsage ?? {});
        break;
      }
    }

    const finalMessage = assistantChunks.join("\n");
    this.transcript.push({ role: "assistant", content: finalMessage });
    return { finalMessage, transcript: [...this.transcript], usage: { ...this.usage } };
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  close(): void {
    this.input.close();
  }

  private applyUsage(modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>): void {
    for (const model of Object.values(modelUsage)) {
      this.usage.inputTokens += model.inputTokens ?? 0;
      this.usage.outputTokens += model.outputTokens ?? 0;
      this.usage.cacheReadTokens += model.cacheReadInputTokens ?? 0;
      this.usage.cacheWriteTokens += model.cacheCreationInputTokens ?? 0;
    }
  }
}

export class ClaudeAgentProvider implements AgentProvider {
  readonly name = "claude";
  private counter = 0;

  async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
    const id = `${options.role}-${++this.counter}`;
    const input = new AsyncQueue<SDKUserMessage>();
    const mcpServer = buildMcpServer(`specos-${options.role}`, options.tools);

    const queryOptions: Options = {
      cwd: options.cwd,
      systemPrompt: options.systemPrompt,
      permissionMode: ROLE_PERMISSION_MODE[options.role],
      maxTurns: options.maxTurns,
      mcpServers: { [`specos-${options.role}`]: mcpServer },
    };

    const session = query({ prompt: input, options: queryOptions }) as AsyncGenerator<any, void>;
    return new ClaudeAgentHandle(id, options.role, input, session);
  }
}
