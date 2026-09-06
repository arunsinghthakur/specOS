export interface RawSpecInput {
  /** Stable id derived from the source (file path + section slug, or Jira key). */
  id: string;
  sourceType: "markdown" | "text" | "jira";
  sourceRef: string;
  rawText: string;
}
