import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/load.js";
import { createProvider } from "../../engine/core/registry.js";
import { applyStoredAnthropicKey } from "../../integrations/anthropic/apply.js";
import { parseMarkdownSpec } from "../../spec/parsers/markdown.js";
import { parseTextSpec } from "../../spec/parsers/text.js";
import { ingestRawInput } from "../../spec/ingest.js";
import { readSpecNodes, writeSpecNodes } from "../../spec/specFiles.js";
import { TaskGraph } from "../../spec/taskGraph.js";
import { JiraClient } from "../../integrations/jira/client.js";
import { loadJiraCredentials } from "../../integrations/jira/credentials.js";
import { commitPaths } from "../../integrations/git/worktree.js";
import { askUser } from "../prompt.js";
import type { RawSpecInput } from "../../spec/rawInput.js";
import type { SpecNode } from "../../spec/schema.js";

const JIRA_ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

interface AddOptions {
  jira?: string;
  text?: string;
  id?: string;
  yes?: boolean;
}

export function registerSpecCommand(program: Command): void {
  const spec = program.command("spec").description("Ingest spec sources into specs/<id>.md");

  spec
    .command("add [file]")
    .description(
      "Normalize a Markdown/text spec file, a Jira card or JQL query (--jira), or an ad-hoc " +
        "requirement (--text) into specs/<id>.md",
    )
    .option("--jira <jql-or-key>", "a JQL query, or a single Jira issue key (e.g. PROJ-45), to ingest instead of a file")
    .option("--text <requirement>", "ingest one ad-hoc plain-text requirement instead of a file")
    .option("--id <id>", "task id to use with --text (default: a slug of its first few words)")
    .option("--yes", "skip interactive clarification — just warn on ambiguity instead of asking questions")
    .action(async (file: string | undefined, opts: AddOptions) => {
      const sources = [file, opts.jira, opts.text].filter((v) => v !== undefined);
      if (sources.length === 0) {
        throw new Error("Provide a spec file path, --jira <jql-or-key>, or --text <requirement>.");
      }
      if (sources.length > 1) {
        throw new Error("Provide only one of: a spec file, --jira, or --text.");
      }

      const repoRoot = process.cwd();
      const config = await loadConfig();
      await applyStoredAnthropicKey();
      const provider = createProvider(config);

      const rawInputs: RawSpecInput[] = file
        ? parseMarkdownSpec(file, await readFile(file, "utf-8"))
        : opts.text
          ? [parseTextSpec(opts.text, opts.id)]
          : await fetchJiraInputs(opts.jira!, config);

      if (rawInputs.length === 0) {
        console.log("No spec sections found.");
        return;
      }

      const existingIds = new Set((await readSpecNodes(repoRoot)).map((n) => n.id));

      const nodes: SpecNode[] = [];
      for (const raw of rawInputs) {
        console.log(`Normalizing ${raw.id}...`);
        const node = await ingestRawInput(provider, raw, {
          askUser: opts.yes ? undefined : askUser,
          warn: (message) => console.warn(`  ${message}`),
          offerMoreDetails: Boolean(opts.text),
        });
        nodes.push(node);
      }

      const changedPaths = await writeSpecNodes(nodes, repoRoot);
      const allNodes = await readSpecNodes(repoRoot);
      new TaskGraph(allNodes); // validates the merged graph is acyclic and dependency-complete

      if (changedPaths.length === 0) {
        console.log(`No changes — ${allNodes.length} task(s) in specs/ already up to date.`);
        return;
      }

      const changedIds = changedPaths.map((p) => path.basename(p, ".md"));
      const added = changedIds.filter((id) => !existingIds.has(id));
      const updated = changedIds.filter((id) => existingIds.has(id));
      const message = [
        "specos: spec —",
        added.length > 0 ? `add ${added.join(", ")}` : "",
        updated.length > 0 ? `update ${updated.join(", ")}` : "",
      ]
        .filter((part) => part.length > 0)
        .join(" ");

      const committed = await commitPaths(
        repoRoot,
        changedPaths.map((p) => path.relative(repoRoot, p)),
        message,
      );
      console.log(
        `Wrote ${changedPaths.length} of ${allNodes.length} task(s) to specs/` +
          (committed ? " and committed the change." : "."),
      );
    });
}

async function fetchJiraInputs(jqlOrKey: string, config: Awaited<ReturnType<typeof loadConfig>>): Promise<RawSpecInput[]> {
  if (!config.jira?.host || !config.jira?.email) {
    throw new Error("Jira is not configured. Run `specos auth jira --host <url> --email <email>` first.");
  }
  const credentials = await loadJiraCredentials(config.jira.email);
  if (!credentials) {
    throw new Error(`No stored Jira credentials for ${config.jira.email}. Run \`specos auth jira\` first.`);
  }
  const client = new JiraClient({ host: config.jira.host, credentials });
  // A bare issue key (e.g. "PROJ-45") is a common enough shorthand for "just this one card" that
  // it's worth accepting directly, rather than making every single-card ingest spell out JQL.
  const jql = JIRA_ISSUE_KEY_RE.test(jqlOrKey.trim()) ? `key = "${jqlOrKey.trim()}"` : jqlOrKey;
  return client.searchIssues(jql);
}
