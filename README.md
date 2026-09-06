# specOS

A CLI tool that takes a spec (Markdown/text files, or live Jira issues) and drives it end-to-end
to working, merged code — using a swarm of Claude agents working in isolated git worktrees,
coordinated by an orchestrator, kept within guardrails by a harness, and kept token-efficient
via tiered memory management.

```
spec.md / Jira  →  spec.lock.json  →  task graph  →  worker agents (git worktrees)
                                                            ↓
                                    reviewer agent  →  approval gate  →  merge
```

## How it works

1. **SDD (spec-driven development)** — `specos spec add` parses a Markdown/text file (or pulls
   Jira issues via JQL) and runs each section through a **normalizer agent** (raw text → a
   structured `{title, description, acceptanceCriteria, dependencies, priority, ...}` node) and a
   **validator agent** (flags ambiguity/missing info as clarifying questions before you plan).
   The result is a versioned `spec.lock.json` — the single source of truth for every later step.
2. **Task graph** — `specos plan` builds a dependency graph from `spec.lock.json` and shows the
   execution order. Tasks with no unmet dependencies are "ready" to run.
3. **Agent swarm** — `specos run` runs up to `concurrency` ready tasks in parallel. Each task gets
   its own git worktree and branch; a **worker agent** implements it there, sandboxed to
   read/write/list/exec tools scoped to that worktree only (no access to your shell, home
   directory, or other tasks' worktrees).
4. **Review + merge** — once a worker finishes, a **reviewer agent** (read-only — no write access)
   checks the diff against the task's acceptance criteria and optionally runs your test command.
   If approved, the orchestrator dry-run merges into the integration branch to catch conflicts; on
   a real conflict, a **conflict-resolver agent** attempts a fix, still gated by human approval
   before anything is actually committed. Merges are serialized even though workers run in
   parallel, since they share one integration-branch checkout.
5. **Harness** — every task moves through an explicit state machine
   (`pending → assigned → in_progress → review → merged`, with `blocked`/`failed` off-ramps),
   checkpointed to a local SQLite store so a run survives a crash (`specos resume`). Guardrails
   include per-task timeouts, retry-with-backoff, and a run-level circuit breaker.
6. **Memory / token optimization** — each worker only ever sees its own task, not the whole spec
   or codebase. Completed tasks are compacted into one-line summaries (reusing the worker's own
   sign-off message when possible — no extra model call) and shared via a lightweight swarm
   memory file, so later tasks know what already exists without re-reading full transcripts. Full
   transcripts are archived to disk for audit, never re-loaded into context. `specos status
   --usage` shows cumulative token usage against an optional budget.

## Setup

Requires Node.js ≥ 20 and git.

```bash
cd specOS
npm install
npm run build
npm link          # installs the `specos` command globally (symlinks to dist/)
```

`npm link` makes `specos` available as a plain command from any directory. If you edit anything
under `src/`, run `npm run build` again to pick up the changes — the linked command runs the
compiled `dist/`, not your source directly.

Alternative without linking: run `npx tsx src/cli/index.ts <command>` from inside the `specOS`
directory (useful while developing specOS itself, since it skips the build step).

### Claude Agent SDK auth

specOS's default provider spawns the `claude` CLI under the hood (via the Claude Agent SDK), so
it authenticates the same way your `claude` CLI already does — no separate API key setup needed
if `claude` already works in your terminal. If your `claude` CLI runs through a custom endpoint
(e.g. an internal gateway configured via `~/.claude/settings.json`'s `env.ANTHROPIC_BASE_URL` and
`apiKeyHelper`), make sure that same `ANTHROPIC_BASE_URL` is exported in whatever shell you run
`specos` from — some sandboxed/CI shells don't inherit app-level environment overrides, which
shows up as an "Invalid API key" error even though your `claude` login is fine.

## End-to-end usage

All commands run from the root of the project you want specOS to build (a git repository).

### 1. Initialize

```bash
cd my-project        # must be a git repo (git init if it's brand new)
specos init --concurrency 2
```

Writes `specos.config.json`. Useful flags:

| Flag | Meaning | Default |
|---|---|---|
| `--provider <name>` | agent provider to use | `claude` |
| `--concurrency <n>` | max parallel worker agents | `4` |
| `--max-tokens <n>` | stop starting new tasks once cumulative usage reaches this | unset (no budget) |

`init` also appends `.specos/` to your project's `.gitignore` if one already exists (that's where
run state, transcripts, and the audit log live).

### 2. Write a spec

Plain Markdown, split into sections by `#`/`##` headings — each section becomes one task. Mention
dependencies explicitly so the normalizer can pick them up, e.g. "Depends on: `<other-task-id>`"
(a task's id is `<file-basename>-<slugified-heading>`, e.g. `spec-todo-storage` for a heading
"Todo Storage" in `spec.md`). Write concrete acceptance criteria — the worker and reviewer agents
build and grade against exactly what you write here.

### 3. Ingest the spec

```bash
specos spec add spec.md
```

Runs the normalizer + validator agents over every section and writes/merges into
`spec.lock.json`. If the validator flags a section as ambiguous, it prints clarifying questions —
worth fixing your spec and re-running `spec add` before planning, since the worker agent will
otherwise have to guess.

For Jira instead of a file:

```bash
specos auth jira --host https://your-org.atlassian.net --email you@example.com --token <api-token>
# (or set JIRA_API_TOKEN instead of --token; the token is stored in your OS keychain, never in a file)

specos spec add --jira "project = PROJ AND status = 'To Do'"
```

### 4. Inspect the plan

```bash
specos plan
```

Dry run — prints the dependency-ordered task list, writes no code. Good place to sanity-check the
task graph (and catch dependency cycles/typos) before spending real agent turns.

### 5. Run it

```bash
specos run --test-command "npm test" --yes
```

| Flag | Meaning |
|---|---|
| `--test-command <cmd>` | command the reviewer agent runs to verify each task (e.g. `"npm test"`) |
| `--yes` | auto-approve gates that aren't in `forceManualGates` in config |
| `--push <remote>` | once every task is merged, gate (and if approved, perform) a push of the integration branch to this remote |

Without `--yes`, you'll get an interactive `y/N` prompt at each configured approval gate (merge,
destructive git ops, final integration) — see [Approval gates](#approval-gates) below.

### 6. Check status / resume / retry

```bash
specos status --usage      # task states + cumulative token usage
specos resume               # re-run after a crash/interruption — identical to `run`, since
                             # all state is persisted to .specos/state.db and re-read every time
specos retry <taskId>       # discard a blocked/failed task's worktree+branch and reset it to
                             # pending, so the next `specos run` retries it from scratch
```

## Approval gates

Three gates, each independently toggleable in `specos.config.json`:

| Gate | Fires before |
|---|---|
| `merge` | merging a task's branch into the integration branch (including a conflict-resolver's fix) |
| `destructive_git` | `specos retry` discarding a worktree/branch |
| `final_integration` | `specos run --push <remote>` pushing to a remote |

```json
{
  "approvalGates": ["merge", "destructive_git", "final_integration"],
  "forceManualGates": []
}
```

- `approvalGates` — which gates are active at all. Remove one to skip its prompt entirely (even
  without `--yes`).
- `forceManualGates` — gates that must always prompt, even when `--yes`/`--yes`-equivalent flags
  are passed. Use this for e.g. `final_integration` if you never want a push to happen
  unattended, regardless of how `run` is invoked.

## Configuration reference (`specos.config.json`)

| Field | Type | Default |
|---|---|---|
| `provider` | `"claude"` | `"claude"` |
| `concurrency` | integer 1–16 | `4` |
| `budget.maxTokens` | integer | unset |
| `budget.maxUsd` | number | unset (not enforced yet — no live pricing table) |
| `approvalGates` | array of `"merge" \| "destructive_git" \| "final_integration"` | all three |
| `forceManualGates` | array of same enum | `[]` |
| `integrationBranch` | string | `"main"` |
| `jira.host` / `jira.email` | string | unset (set via `specos auth jira`) |

## What gets written to your project

```
specos.config.json     # config (commit this)
spec.lock.json          # canonical ingested spec (commit this)
.specos/
  state.db              # SQLite run state (task status, token usage) — gitignored
  audit.jsonl            # every state transition + reviewer verdict — gitignored
  memory/
    project.md            # optional: hand-written conventions, auto-loaded into every agent's
                           # system prompt if present — commit this if you create it
    swarm.jsonl            # one-line summaries of completed tasks — gitignored
  transcripts/*.json      # full agent transcripts, for audit only — gitignored
  worktrees/              # transient — removed automatically after each task merges
```

## Development (working on specOS itself)

```bash
npm run dev -- <command>     # run the CLI from source via tsx, no build step
npm run typecheck             # tsc --noEmit
npm test                      # vitest — unit/integration tests, all against mocked or real
                               # local git repos, no live API calls
npm run build                  # compile to dist/ (what `specos` on your PATH actually runs)
```

There is no dev server / nothing to preview in a browser — this is a CLI tool end to end.
