import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z, type ZodRawShape } from "zod";
import type { ToolDefinition, ToolFieldType } from "../../core/types.js";

const FIELD_SCHEMAS: Record<ToolFieldType, z.ZodType> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
};

function toZodShape(inputSchema: Record<string, ToolFieldType>): ZodRawShape {
  return Object.fromEntries(Object.entries(inputSchema).map(([key, type]) => [key, FIELD_SCHEMAS[type]]));
}

/**
 * Wraps our provider-agnostic ToolDefinition[] as a Claude Agent SDK in-process
 * MCP server, so the same tool implementations (worktree-scoped fs, git, test-runner)
 * can be reused if another AgentProvider is added later.
 */
export function buildMcpServer(serverName: string, tools: ToolDefinition[]) {
  return createSdkMcpServer({
    name: serverName,
    // Without this, MCP tools are deferred behind a "tool search" mechanism that we've
    // implicitly disabled by turning off all built-in tools (`tools: []` in the provider) —
    // deferred tools would never surface to the model at all, so force them always-loaded.
    alwaysLoad: true,
    tools: tools.map((def) =>
      tool(
        def.name,
        def.description,
        // A generic z.record()/passthrough shape here silently breaks MCP tool listing
        // (the server connects but the tool never appears in the model's tool list) —
        // each field must be a concrete zod type for the schema conversion to succeed.
        toZodShape(def.inputSchema),
        async (args) => {
          const result = await def.handler(args as Record<string, unknown>);
          return {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
          };
        },
        { alwaysLoad: true },
      ),
    ),
  });
}
