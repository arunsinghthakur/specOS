import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../engine/core/types.js";

const execFileAsync = promisify(execFile);

/** Resolves a path relative to `root` and rejects any attempt to escape it (sandboxing for worker/reviewer tools). */
function resolveScoped(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path "${relativePath}" escapes the sandboxed worktree root.`);
  }
  return resolved;
}

function readFileTool(worktreeRoot: string): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file relative to the worktree root.",
    inputSchema: { path: "string" },
    handler: async (input) => readFile(resolveScoped(worktreeRoot, String(input.path)), "utf-8"),
  };
}

function writeFileTool(worktreeRoot: string): ToolDefinition {
  return {
    name: "write_file",
    description: "Write a UTF-8 text file relative to the worktree root, creating parent directories as needed.",
    inputSchema: { path: "string", content: "string" },
    handler: async (input) => {
      const filePath = resolveScoped(worktreeRoot, String(input.path));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, String(input.content), "utf-8");
      return `wrote ${input.path}`;
    },
  };
}

function listDirTool(worktreeRoot: string): ToolDefinition {
  return {
    name: "list_dir",
    description: "List entries in a directory relative to the worktree root. Pass \".\" for the worktree root itself.",
    inputSchema: { path: "string" },
    handler: async (input) => readdir(resolveScoped(worktreeRoot, String(input.path))),
  };
}

function runCommandTool(worktreeRoot: string): ToolDefinition {
  return {
    name: "run_command",
    description: "Run a shell command (e.g. build/test/lint) with cwd set to the worktree root.",
    inputSchema: { command: "string" },
    handler: async (input) => {
      try {
        const { stdout, stderr } = await execFileAsync("sh", ["-c", String(input.command)], {
          cwd: worktreeRoot,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { ok: true, stdout, stderr };
      } catch (err) {
        const error = err as { stdout?: string; stderr?: string; message: string };
        return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message };
      }
    },
  };
}

/** Full read/write/list/exec tool set for the worker role — the only role allowed to modify files. */
export function buildWorkerTools(worktreeRoot: string): ToolDefinition[] {
  return [readFileTool(worktreeRoot), writeFileTool(worktreeRoot), listDirTool(worktreeRoot), runCommandTool(worktreeRoot)];
}

/** Read-only + exec tool set for the reviewer/conflict-inspection roles — no write_file, so they cannot alter code under review. */
export function buildReadOnlyTools(worktreeRoot: string): ToolDefinition[] {
  return [readFileTool(worktreeRoot), listDirTool(worktreeRoot), runCommandTool(worktreeRoot)];
}
