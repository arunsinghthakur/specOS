import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../../config/load.js";
import { createProvider } from "../../engine/core/registry.js";
import { parseMarkdownSpec } from "../../spec/parsers/markdown.js";
import { normalizeSpec } from "../../spec/agents/normalizer.js";
import { validateSpec } from "../../spec/agents/validator.js";
import { writeSpecLock } from "../../spec/lock.js";
import { TaskGraph } from "../../spec/taskGraph.js";
import { JiraClient } from "../../integrations/jira/client.js";
import { loadJiraCredentials } from "../../integrations/jira/credentials.js";
import type { RawSpecInput } from "../../spec/rawInput.js";
import type { SpecNode } from "../../spec/schema.js";

export function registerSpecCommand(program: Command): void {
  const spec = program.command("spec").description("Ingest spec sources into spec.lock.json");

  spec
    .command("add [file]")
    .description("Normalize a Markdown/text spec file, or Jira issues matching --jira <jql>, into spec.lock.json")
    .option("--jira <jql>", "JQL query selecting Jira issues to ingest instead of a file")
    .action(async (file: string | undefined, opts: { jira?: string }) => {
      if (!file && !opts.jira) {
        throw new Error("Provide a spec file path or --jira <jql>.");
      }

      const config = await loadConfig();
      const provider = createProvider(config);

      const rawInputs: RawSpecInput[] = file
        ? parseMarkdownSpec(file, await readFile(file, "utf-8"))
        : await fetchJiraInputs(opts.jira!, config);

      if (rawInputs.length === 0) {
        console.log("No spec sections found.");
        return;
      }

      const nodes: SpecNode[] = [];
      for (const raw of rawInputs) {
        console.log(`Normalizing ${raw.id}...`);
        const node = await normalizeSpec(provider, raw);
        const validation = await validateSpec(provider, node);
        if (validation.ambiguous) {
          console.warn(`  ambiguous — clarify before planning:`);
          for (const q of validation.questions) console.warn(`    - ${q}`);
        }
        nodes.push(node);
      }

      const lock = await writeSpecLock(nodes);
      new TaskGraph(lock.nodes); // validates the merged graph is acyclic and dependency-complete
      console.log(`Wrote spec.lock.json with ${lock.nodes.length} task(s).`);
    });
}

async function fetchJiraInputs(jql: string, config: Awaited<ReturnType<typeof loadConfig>>): Promise<RawSpecInput[]> {
  if (!config.jira?.host || !config.jira?.email) {
    throw new Error("Jira is not configured. Run `specos auth jira --host <url> --email <email>` first.");
  }
  const credentials = await loadJiraCredentials(config.jira.email);
  if (!credentials) {
    throw new Error(`No stored Jira credentials for ${config.jira.email}. Run \`specos auth jira\` first.`);
  }
  const client = new JiraClient({ host: config.jira.host, credentials });
  return client.searchIssues(jql);
}
