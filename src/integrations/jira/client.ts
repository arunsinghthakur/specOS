import { adfToPlainText, type AdfNode } from "./adf.js";
import type { RawSpecInput } from "../../spec/rawInput.js";
import type { JiraCredentials } from "./credentials.js";

export interface JiraClientOptions {
  host: string; // e.g. https://your-org.atlassian.net
  credentials: JiraCredentials;
  fetchImpl?: typeof fetch;
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: AdfNode | null;
    priority?: { name: string } | null;
    issuelinks?: Array<{
      type: { inward: string; outward: string };
      inwardIssue?: { key: string };
      outwardIssue?: { key: string };
    }>;
    parent?: { key: string };
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  startAt: number;
  maxResults: number;
  total: number;
}

export class JiraClient {
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: JiraClientOptions) {
    const token = Buffer.from(`${options.credentials.email}:${options.credentials.apiToken}`).toString("base64");
    this.authHeader = `Basic ${token}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Fetches all issues matching a JQL query, paginating through Jira's search API. */
  async searchIssues(jql: string): Promise<RawSpecInput[]> {
    const inputs: RawSpecInput[] = [];
    let startAt = 0;
    const maxResults = 50;

    for (;;) {
      const url = new URL("/rest/api/3/search", this.options.host);
      url.searchParams.set("jql", jql);
      url.searchParams.set("startAt", String(startAt));
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("fields", "summary,description,priority,issuelinks,parent");

      const res = await this.fetchImpl(url.toString(), {
        headers: { Authorization: this.authHeader, Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Jira search failed: ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as JiraSearchResponse;
      inputs.push(...body.issues.map(issueToRawSpecInput));

      startAt += body.issues.length;
      if (startAt >= body.total || body.issues.length === 0) break;
    }

    return inputs;
  }
}

function issueToRawSpecInput(issue: JiraIssue): RawSpecInput {
  const description = adfToPlainText(issue.fields.description);
  const dependsOn = (issue.fields.issuelinks ?? [])
    .map((link) => link.inwardIssue?.key ?? link.outwardIssue?.key)
    .filter((key): key is string => Boolean(key));

  const rawText = [
    `Title: ${issue.fields.summary}`,
    issue.fields.priority ? `Priority: ${issue.fields.priority.name}` : null,
    issue.fields.parent ? `Epic: ${issue.fields.parent.key}` : null,
    dependsOn.length > 0 ? `Depends on: ${dependsOn.join(", ")}` : null,
    "",
    description,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    id: issue.key,
    sourceType: "jira",
    sourceRef: issue.key,
    rawText,
  };
}
