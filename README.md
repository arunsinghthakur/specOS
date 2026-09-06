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

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/specOS/main/install.sh | bash
```

One command: clones (or updates) the repo, `npm install`, `npm run build`, and `npm link`s the
`specos` command onto your PATH. Requires Node.js ≥ 20 and git. Update `<org>` once this repo is
pushed to its real remote (`git remote add origin <url>` and push) — until then, run the same
script locally instead:

```bash
git clone <this-repo-url> specOS && cd specOS && bash install.sh
```

Both forms are the same script (`install.sh` at the repo root) — the remote one just fetches it
via curl first. See [Setup](#setup) below for the manual, step-by-step equivalent if you'd rather
not run a script from the internet.

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

## Worked example

A minimal end-to-end run, start to finish, building a command-line todo app from scratch:

```bash
mkdir todo-app && cd todo-app
git init -b main
specos init --concurrency 2
```

`spec.md`:

```markdown
# Project Setup

Set up a minimal Node.js project for a command-line todo app.

Acceptance criteria:
- A `package.json` exists with `"type": "module"` and a `"test"` script running `node --test`.
- A `src/` directory exists as the source root.
- Running `node --test` succeeds and exits with code 0, even with zero test files yet.

# Todo Storage

Implement an in-memory todo storage module at `src/storage.js`.

Depends on: spec-project-setup

Acceptance criteria:
- Exports `createStore()`, returning `{ add(text), list(), complete(id) }` with per-instance state.
- `add(text)` creates a todo with a unique numeric id, the given text, and `done: false`.
- `list()` returns all todos in the order added. `complete(id)` marks one done (or returns
  `undefined` for an unknown id).
- At least 3 unit tests in `test/storage.test.js` using `node:test`/`node:assert`.

# CLI Commands

Implement a CLI at `src/cli.js` on top of the storage module. Each invocation is a separate
process, so persist todos to a `todos.json` file between invocations.

Depends on: spec-todo-storage

Acceptance criteria:
- `node src/cli.js add "buy milk"` prints `Added: <id> - buy milk` and persists it to `todos.json`.
- `node src/cli.js list` prints one line per todo as `<id> [x] text` / `<id> [ ] text`.
- `node src/cli.js complete <id>` marks it done, or prints an error and exits non-zero for an
  unknown id.
```

```bash
specos spec add spec.md      # normalize + validate → spec.lock.json
specos plan                   # sanity-check the dependency-ordered task list
specos run --yes --test-command "npm test"
```

`plan` prints:

```
3 task(s), execution order (dependencies first):

  [high] spec-project-setup — Project Setup
  [medium] spec-todo-storage — Todo Storage (depends on: spec-project-setup)
  [medium] spec-cli-commands — CLI Commands (depends on: spec-todo-storage)
```

`run` works through the graph, and afterward:

```bash
node src/cli.js add "buy milk"     # Added: 1 - buy milk
node src/cli.js list                # 1 [ ] buy milk
node src/cli.js complete 1          # Completed: 1
npm test                            # all green
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

## Troubleshooting

**`Cannot find module '.../src/src/cli/index.ts'`** — you ran `npx tsx src/cli/index.ts ...` from
inside the `src/` directory instead of the repo root, so the path got doubled up. Either `cd ..`
back to the repo root first, or (better) run `specos <command>` after `npm link` — see
[Quick install](#quick-install) — so you don't need to think about paths at all.

**`Invalid API key` / `Fix external API key`** — specOS's `claude` subprocess isn't picking up the
right auth. If your `claude` CLI normally authenticates through a custom gateway (an `env` block
in `~/.claude/settings.json`), that same `ANTHROPIC_BASE_URL` needs to be exported in the shell
you're running `specos` from — some sandboxed/CI shells reset it to the public API default, which
then fails against a gateway-issued key. `export ANTHROPIC_BASE_URL=<your gateway URL>` before
running `specos` fixes it. `claude -p "hi"` in the same shell is a quick way to confirm auth works
before blaming specOS.

**"The dev server failed to start"** — specOS has no dev server; it's a CLI tool, not a web app.
Nothing to preview in a browser. Run its commands directly in a terminal instead.

**A section is marked ambiguous by `spec add`** — that's the validator agent doing its job, not
an error. Read the printed questions, tighten the acceptance criteria in your spec, and re-run
`specos spec add <file>`. It's safe to re-run — nodes merge into `spec.lock.json` by id, so tasks
from other files are untouched — but every section in *this* file gets re-normalized and
re-validated (a fresh model call each), not just the one you changed.

**A task ends up `blocked`** — check `specos status` for which one, then `.specos/audit.jsonl`
for the reviewer's feedback or the merge-conflict reason. Fix the spec/task if needed, then
`specos retry <taskId>` to discard its worktree/branch and requeue it, followed by `specos run`
again.

## Development (working on specOS itself)

```bash
npm run dev -- <command>     # run the CLI from source via tsx, no build step
npm run typecheck             # tsc --noEmit
npm test                      # vitest — unit/integration tests, all against mocked or real
                               # local git repos, no live API calls
npm run build                  # compile to dist/ (what `specos` on your PATH actually runs)
```

There is no dev server / nothing to preview in a browser — this is a CLI tool end to end.
