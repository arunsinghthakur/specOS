import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";

/**
 * Wraps our provider-agnostic ToolDefinition[] as a Claude Agent SDK in-process
 * MCP server, so the same tool implementations (worktree-scoped fs, git, test-runner)
 * can be reused if another AgentProvider is added later.
 */
export function buildMcpServer(serverName: string, tools: ToolDefinition[]) {
  return createSdkMcpServer({
    name: serverName,
    tools: tools.map((def) =>
      tool(
        def.name,
        def.description,
        // JSON-schema tools are exposed to agents as a passthrough object; strict
        // per-field zod validation happens inside each handler.
        { input: z.record(z.string(), z.unknown()).describe(JSON.stringify(def.inputSchema)) },
        async (args) => {
          const result = await def.handler((args.input as Record<string, unknown>) ?? {});
          return {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
          };
        },
      ),
    ),
  });
}
