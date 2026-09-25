const GLYPH_HEIGHT = 5;

/** 5-row bitmap font, uppercase letters only — just enough to render "SPECOS". */
const FONT: Record<string, string[]> = {
  S: ["###", "#  ", "###", "  #", "###"],
  P: ["###", "# #", "###", "#  ", "#  "],
  E: ["###", "#  ", "###", "#  ", "###"],
  C: ["###", "#  ", "#  ", "#  ", "###"],
  O: ["###", "# #", "# #", "# #", "###"],
};

function renderWord(word: string): string {
  const glyphs = word
    .toUpperCase()
    .split("")
    .map((ch) => FONT[ch] ?? ["   ", "   ", "   ", "   ", "   "]);
  const rows: string[] = [];
  for (let row = 0; row < GLYPH_HEIGHT; row++) {
    rows.push(glyphs.map((glyph) => glyph[row]).join(" "));
  }
  return rows.join("\n");
}

export const LOGO = renderWord("SPECOS");

export function printBanner(): void {
  console.log(`\n${LOGO}\n`);
  console.log("Spec-driven, multi-agent SDLC orchestrator\n");
}

export function printQuickStart(): void {
  console.log("Quick start:");
  console.log("  specos setup                   store credentials (Anthropic key, Jira) — safe to skip");
  console.log("  specos init                    scaffold specos.config.json in this project");
  console.log('  specos spec add <file>         ingest a spec (file, --jira <jql-or-key>, or --text "...")');
  console.log("  specos plan                    dry-run the dependency-ordered task graph");
  console.log('  specos run --yes --test-command "npm test"   run the agent swarm end to end');
  console.log("  specos status --usage          check task states + token usage");
  console.log("\nFull docs: https://github.com/arunsinghthakur/specOS#readme");
}
