import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentActivityEvent,
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

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

class ClaudeAgentHandle implements AgentHandle {
  readonly id: string;
  readonly role: AgentRole;
  private readonly input: AsyncQueue<SDKUserMessage>;
  private readonly session: AsyncGenerator<any, void>;
  private readonly transcript: AgentMessage[] = [];
  private readonly onActivity?: (event: AgentActivityEvent) => void;
  private usage: TokenUsage = zeroUsage();
  private turn = 0;

  constructor(
    id: string,
    role: AgentRole,
    input: AsyncQueue<SDKUserMessage>,
    session: AsyncGenerator<any, void>,
    onActivity?: (event: AgentActivityEvent) => void,
  ) {
    this.id = id;
    this.role = role;
    this.input = input;
    this.session = session;
    this.onActivity = onActivity;
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
          if (block.type === "text") {
            assistantChunks.push(block.text);
            this.onActivity?.({ type: "text", text: block.text });
          }
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
    // Notify the moment a tool is invoked, before its (possibly slow) handler runs — that's
    // what makes a long `run_command` or `write_file` call show up live instead of only after
    // it finishes. Every ToolDefinition flows through here regardless of role, so this is the
    // one place that needs to know about `onActivity`, not each tool implementation.
    const tools = options.onActivity
      ? options.tools.map((def) => ({
          ...def,
          handler: (toolInput: Record<string, unknown>) => {
            options.onActivity?.({ type: "tool_call", tool: def.name, input: toolInput });
            return def.handler(toolInput);
          },
        }))
      : options.tools;
    const mcpServer = buildMcpServer(`specos-${options.role}`, tools);

    const queryOptions: Options = {
      cwd: options.cwd,
      systemPrompt: options.systemPrompt,
      maxTurns: options.maxTurns,
      // Disable every native built-in tool (Read/Write/Edit/Bash/...) — agents get only the
      // worktree-sandboxed tools we hand them via `options.tools`, enforcing the harness's
      // per-role file/path boundaries instead of relying on the SDK's permission system.
      tools: [],
      mcpServers: { [`specos-${options.role}`]: mcpServer },
      // query() runs headless with no TTY to answer an interactive permission prompt, and our
      // own tool sandboxing (per-role tool sets + resolveScoped path confinement) is already
      // the real boundary enforcement here, so bypass the SDK's own permission system entirely.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    };

    const session = query({ prompt: input, options: queryOptions }) as AsyncGenerator<any, void>;
    return new ClaudeAgentHandle(id, options.role, input, session, options.onActivity);
  }
}
