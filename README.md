# cli-vs-mcp

A harness for comparing **Claude Code**'s behavior across three tool surfaces on the same task:

- **`baseline`** — no execution surface (the reasoning floor)
- **`skill`** — a Claude Code Skill that wraps a CLI binary
- **`mcp`** — an MCP server that exposes structured tools

Two experiments are wired up:

| Experiment | Skill arm | MCP arm |
|---|---|---|
| `playwright` | `playwright-cli` skill + `Bash(playwright-cli:*)` | `@playwright/mcp@0.0.75` via stdio |
| `github`     | `github-cli` skill + `Bash(gh:*)`                   | `ghcr.io/github/github-mcp-server` (digest-pinned) via docker stdio |

Same prompts run through every arm, in fresh per-trial tempdirs, with tightly curated allow/deny lists. We record tokens, turns, wall-clock time, success score, and tool-surface validity.

## Approach

Each trial isolates one variable — the tool surface — and holds everything else equal:

1. A **paired seed** `hash(experiment, runName, taskId, trialN)` drives all per-trial state, so all three arms attempting `tier1_scrape` trial 3 see the same randomized table.
2. **Per-trial answers stay off disk.** Playwright fixtures are HTML templates rendered dynamically by an in-process HTTP server; GitHub state lives in a private sandbox repo provisioned by a controller token the agent never sees.
3. The agent runs in a **fresh tempdir** with `--strict-mcp-config`, a positive `--allowed-tools` list, an explicit deny list, and `--setting-sources project,local` (so the developer's `~/.claude` skills don't leak in).
4. Always blocked across every arm — five Claude Code tools that would otherwise be available to `claude -p` by default, each a different escape an agent could reach for when `Bash` is constrained: `WebFetch` and `WebSearch` (network fetch), `Monitor` (background-process listener that streams stdout into the conversation), `CronCreate` (in-session scheduled prompts), and `RemoteTrigger` (Routines on claude.ai that run on Anthropic-managed infrastructure independently of the session).

The result of each trial is one JSON file containing the measurements, plus the full stream-json transcript.

## Repo layout

```
cli-vs-mcp/
├── harness/src/
│   ├── cli.ts                           # commander entry: run / report / verify-arms / recompute-metrics
│   ├── runner.ts                        # per-trial: tempdir, fixture server, claude exec, env scrub
│   ├── metrics.ts                       # stream-json transcript parser + classifier dispatch
│   ├── experiment.ts                    # ExperimentSpec interface
│   ├── experiments/
│   │   ├── playwright.ts
│   │   ├── github.ts                    # registers `github` (ro) and `github-rw` (rw)
│   │   └── index.ts                     # registry
│   ├── shell.ts                         # top-level shell-segment parser
│   ├── fixtureServer.ts                 # per-trial HTTP server for Playwright fixtures
│   ├── trialState.ts                    # paired-seed RNG + per-task state generators
│   ├── tasks.ts                         # Task + TaskContext types
│   └── report.ts                        # markdown report generator
├── experiments/
│   ├── playwright/
│   │   ├── tasks/                       # tier1.ts (4 tasks), tier2.ts (2 tasks), index.ts
│   │   ├── fixtures/                    # HTML templates (no per-trial answers on disk)
│   │   └── runs/<run-name>/             # results, transcripts, findings
│   └── github/
│       ├── tasks/                       # tier1.ts (3 tasks), index.ts
│       ├── provisioner.ts               # controller-side GitHub REST helpers
│       └── runs/<run-name>/
├── .claude/skills/
│   ├── playwright-cli/                  # copied into trial tempdirs on `--arm skill`
│   └── github-cli/
├── .mcp.playwright.json                 # @playwright/mcp@0.0.75
├── .mcp.github.ro.json                  # github-mcp-server --read-only
├── .mcp.github.rw.json                  # github-mcp-server read-write
└── CLAUDE.md                            # project instructions for the agent
```

## How a trial runs

`harness/src/runner.ts:runTrial` performs, for each `(experiment, arm, task, trial)`:

1. Computes a paired seed `(experiment, runName, taskId, trialN) → 16 hex` via FNV-1a.
2. Calls `task.setup(seed)` to materialize per-trial state in process memory.
3. For Playwright: starts an HTTP fixture server on `127.0.0.1:<random-port>` that renders the per-trial state into HTML on demand. For GitHub: calls the provisioner to create a private sandbox repo seeded with deterministic content.
4. Spawns `claude -p` in a fresh tempdir (`os.tmpdir() + clivsmcp-<experiment>-<arm>-<task>-<random>`) with:
   - `--strict-mcp-config --mcp-config <experiment-specific config>`
   - `--allowed-tools <per-arm positive list>`
   - `--disallowed-tools <per-arm deny list>`
   - `--setting-sources project,local`
   - `--permission-mode bypassPermissions`
   - `--model claude-sonnet-4-6` (configurable via `--model`)
   - `--output-format stream-json`
5. Captures stdout to `runs/<run>/transcripts/<arm>/<taskId>/<n>.jsonl`.
6. Kills the child after **240 s** wall-clock if it hasn't returned (`runner.ts:TRIAL_TIMEOUT_MS`).
7. Runs `task.successCheck(ctx)` against the trial's output dir, then `task.cleanup(state)`.
8. Writes the result JSON.

## Per-arm tool surfaces

`pnpm harness verify-arms --experiment <name>` probes each arm by asking the agent which tools it can see. The verified surfaces:

### Playwright

| Arm | Allowed | Notes |
|---|---|---|
| `baseline` | `ToolSearch Read Glob Grep Write TodoWrite` | No execution channel. |
| `skill` | `ToolSearch Skill Bash(playwright-cli:*) Write TodoWrite` | Skill bundled at `.claude/skills/playwright-cli/SKILL.md`, copied into the trial tempdir at run time. |
| `mcp` | `ToolSearch Write TodoWrite` + 23 enumerated `mcp__playwright__*` tools | Tools enumerated rather than globbed so the allow-list survives any matcher changes. |

### GitHub

| Arm | Allowed | Notes |
|---|---|---|
| `baseline` | `ToolSearch Read Glob Grep Write TodoWrite` | Same as Playwright baseline. |
| `skill` | `ToolSearch Skill Bash(gh:*) Write TodoWrite` | `Read/Glob/Grep` intentionally omitted; agent must source info from `gh`. |
| `mcp` | `ToolSearch Write TodoWrite` + the `mcp__github__*` set from the running server | `.mcp.github.ro.json` for `--experiment github`; `.mcp.github.rw.json` for `--experiment github-rw`. |

## What each task accomplishes

### Playwright

Fixtures are HTML templates served over HTTP by the per-trial fixture server. Per-trial state (city names, product titles, form nonces) is generated from the paired seed and lives only in process memory, so the agent cannot bypass the browser by reading the source HTML.

**Tier 1 — read-only** (`experiments/playwright/tasks/tier1.ts`)

| Task | Setup | Expected outcome |
|---|---|---|
| `tier1_login` | Login form with hardcoded user/pass | Sign in, screenshot the dashboard, save PNG ≥1 KB |
| `tier1_scrape` | Page with a 5-row table; city/country names randomized per trial | Extract the rows into JSON |
| `tier1_form` | Form whose submit nonce is regenerated per trial | Submit the form, capture the success token |
| `tier1_products` | 5 product pages with seeded titles and prices | Visit each, write a JSON list of `{title, price}` |

**Tier 2 — multi-step / mutation** (`experiments/playwright/tasks/tier2.ts`)

| Task | Setup | Expected outcome |
|---|---|---|
| `tier2_checkout` | A storefront with multiple products; target identified by substring marker | Find the right product, add to cart, complete checkout |
| `tier2_recovery` | Password-reset flow with an inline error code | Read the error code, resubmit with corrected payload, capture the recovery token |

### GitHub

Each task provisions a fresh private repo under `GITHUB_SANDBOX_OWNER` via the controller token, runs the trial against it, then deletes the repo on cleanup. Repo names follow `clivsmcp-<task>-<seed8>`.

**Tier 1 — read-only** (`experiments/github/tasks/tier1.ts`)

| Task | Setup | Expected outcome |
|---|---|---|
| `tier1_repo_inventory` | Private repo with seeded description, topics, and a README containing a hex marker | Report `description`, `topics`, `default_branch`, `readme_marker` as JSON |
| `tier1_issue_triage` | Repo with 5 issues (1 target with a hidden marker in the body, 4 decoys) and a label palette | Find the target issue's number, title, labels, and marker |
| `tier1_pr_diff_answer` | Repo with a feature branch and an open PR that adds one new function to `src/widget.ts` | Report PR number, changed file, and added function name |
| `tier1_workflow_status` | Repo with a workflow `.yml` whose `name:` carries the per-trial marker; controller pushes it and polls until the run completes | Report `{workflow_name, conclusion, head_sha}` of the most recent run. Needs Actions:read on agent + Workflows:write on controller + `actions` in `GITHUB_TOOLSETS`. |

**Tier 2 — mutation** (`experiments/github/tasks/tier2.ts`, selected via `--experiment github-rw`)

| Task | Setup | Expected outcome |
|---|---|---|
| `tier2_issue_workflow` | Repo with 3 issues (1 target with marker in title, 2 decoys) + label palette including `priority-high` | Add `priority-high` label to target, post a comment containing `triaged-<marker>`, close it. Leave decoys untouched. |
| `tier2_file_patch_pr` | Repo with `src/widget.ts` containing a TODO marker on main | Create a branch, replace the TODO with an exported function `solve_<marker>` returning `done-<marker>`, open a PR with marker phrases in title and body. |
| `tier2_file_patch_pr_directed` | Same as `tier2_file_patch_pr` | Same expected outcome, but the prompt explicitly names the in-surface workaround (`gh api -F field=@file` / `--input file` + the `Write` tool). Designed to isolate prompt-knowledge gap from affordance gap. |
| `tier2_issue_create` | Empty repo with seeded label palette | Create one issue with seeded title, body marker, and two labels. Single-primitive write — clean apples-to-apples. |

Tier 2 requires the agent token to have Issues:write / Pull requests:write / Contents:write on the sandbox owner. `tier2_pr_review` is deferred — GitHub forbids `APPROVE`/`REQUEST_CHANGES` from the PR author, so the task needs a distinct PR-author identity. `tier2_release_create` was attempted and pulled — the github-mcp-server has no release write tool under any toolset config, so it isn't an apples-to-apples comparison.

## Measurements captured

Every result JSON at `runs/<run>/results/<arm>/<task>/<n>.json` contains:

```
experiment, runName, arm, taskId, tier, trialN, timestamp, seed
metrics: {
  inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens
  toolCalls[]                          # [{ name, turnIndex, command?, reason? }, …]
  toolCallCount, turns, numTurns
  wallClockMs, contextWindowPeak, totalCostUsd, modelsUsed[]
  usedIntendedTool                     # at least one in-surface tool call
  validToolSurface                     # *every* tool call in-surface
  escapeToolUsed, escapeToolCalls[]    # which calls failed the classifier and why
  singleCliCommandPerToolCall          # research-mode flag
  cliCommandGranularityViolations[]
}
success: { pass, score, notes, extras? }
error?                                 # set on timeout or process failure
```

These are the only fields populated by the parser (`harness/src/metrics.ts:parseTranscript`). Token columns and wall-clock are the cost signals. `validToolSurface` is the trust signal — a passing trial with `validToolSurface=false` succeeded by escaping the intended path, and the per-tier summary in reports filters it out.

## Validity classifier

`harness/src/metrics.ts:parseTranscript` reads the stream-json transcript and, for every `tool_use` event, asks the experiment's classifier whether the call is in-surface for the arm:

- **baseline**: any execution or fetch tool is a violation.
- **skill**: `Skill` must match `intendedSkillName`; `Bash` must satisfy `classifyShellCommand`.
- **mcp**: only `Write`, `TodoWrite`, `ToolSearch`, and the intended `mcp__<prefix>__*` set are valid.

`classifyShellCommand` parses the Bash command into top-level segments (respecting quotes, `;`, `&&`, `||`, `|`, and shell redirections). Each segment must start with the intended CLI binary (`playwright-cli` or `gh`). Segments may not contain backticks, `$(...)` command substitution, or shell helpers (`curl`, `wget`, `cat`, `python`, `sed`, `awk`, `head`, `tail`, `jq`, `base64`, etc.). Shell redirections (`>`, `>>`, `2>&1`) invalidate the segment in every mode — file output must go through the `Write` tool.

### Run modes

- **practical** (default): chained CLI segments in one Bash call are valid as long as every segment is the intended CLI.
- **research-single** (`--single-cli-command` on `run` and `report`): each Bash call must be exactly one intended-CLI invocation. No chaining, no pipes. Stored results contain both flags; the report flag chooses which view to surface.

## Running it

### Setup

```bash
pnpm install
```

Playwright is ready out of the box. GitHub additionally needs:

```bash
# Three tokens / vars in a gitignored .env at repo root:
GITHUB_SANDBOX_OWNER=<org-or-user-slug>     # e.g. cli-vs-mcp-lab
GITHUB_CONTROLLER_TOKEN=<fine-grained PAT>  # held by harness; needs Administration:write, Contents:write, Issues:write, Pull requests:write on the sandbox owner
GITHUB_AGENT_TOKEN=<fine-grained PAT>       # what the agent process sees; read-only on the sandbox owner for Tier 1

docker pull ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4
```

### Commands

```bash
# Probe arm isolation. Run this before any new experiment session.
pnpm harness verify-arms --experiment playwright
pnpm harness verify-arms --experiment github

# Run trials. --trials N runs N seeds per task per arm.
pnpm harness run --experiment playwright --run myrun --arm skill    --tier 1 --trials 5
pnpm harness run --experiment playwright --run myrun --arm mcp      --tier 1 --trials 5
pnpm harness run --experiment playwright --run myrun --arm baseline --tier 1 --trials 5
# (repeat for --tier 2)

# Run one specific task:
pnpm harness run --experiment github --run myrun --arm mcp --task tier1_pr_diff_answer --trials 5

# Generate the markdown report. --crossover-analysis adds a skill-vs-mcp table.
pnpm harness report --experiment playwright --run myrun --all-tiers --crossover-analysis \
  --output experiments/playwright/runs/myrun/findings.md

# Re-parse existing transcripts after a classifier change (won't re-run claude):
pnpm harness recompute-metrics --experiment github --run myrun --arm skill
```

CLI options (`pnpm harness <cmd> --help`):

| Command | Required | Optional |
|---|---|---|
| `run` | `--experiment --run --arm --trials` | `--tier <n>` or `--task <id>` (default: all tasks); `--model` (default `claude-sonnet-4-6`); `--single-cli-command` |
| `report` | `--experiment --run` | `--tier <n>` or `--all-tiers`; `--crossover-analysis`; `--single-cli-command`; `--include-cost`; `--output <path>` |
| `verify-arms` | `--experiment` | `--arm` (defaults to all arms) |
| `recompute-metrics` | `--experiment --run` | `--arm` |

## Status (N=5 run)

Latest run is `n5`: 5 trials per task per arm across both experiments.

**Playwright** (`experiments/playwright/runs/n5/findings.md`)

| Tier | baseline | skill | mcp | Skill/MCP tokens |
|---|---|---|---|---|
| 1 | 0/20 (timeouts) | **20/20** | **20/20** | 1.64× |
| 2 | 0/10 (timeouts) | **10/10** | 7/10 (`tier2_recovery` 2/5) | 2.01× |

MCP is consistently cheaper (per-turn payload smaller — skill emits explicit `playwright-cli snapshot` after every action; MCP bundles it inline). At Tier 2, MCP develops a convergence failure mode on `tier2_recovery` that skill doesn't have at 240 s.

**GitHub Tier 1** (`experiments/github/runs/n5/findings.md`)

| Task | baseline | skill | mcp |
|---|---|---|---|
| `tier1_repo_inventory` | 0/5 | **5/5** | **5/5** |
| `tier1_issue_triage` | 0/5 | **5/5** | **0/5** (all 240 s timeouts at 75+ turns) |
| `tier1_pr_diff_answer` | 0/5 | **5/5** | **5/5** |
| `tier1_workflow_status` | not run | **5/5** | **5/5** |

Two findings only visible from the validity classifier:

1. **Skill arm escapes its surface on 2/3 GitHub tasks.** `tier1_repo_inventory` (5/5 invalid) all pipe `gh api ... | base64 -d` to decode README content. `tier1_issue_triage` (5/5 invalid) included one trial that ran `env | grep -i github` then `GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api ...` to lift the controller's elevated token. The escalation path was open during the n5 run — the runner's scrub list didn't yet include the harness's own `GITHUB_CONTROLLER_TOKEN` / `GITHUB_AGENT_TOKEN` var names. Patched in `ef3fc97` and behaviorally verified in `experiments/github/runs/env-fix-verify`.
2. **MCP `tier1_issue_triage` collapse.** All 5 MCP trials timed out at 75+ turns of fanout across `list_issues`, `search_issues`, `get_issue`. Skill solved the same task in ~23 turns with one `gh issue list --label "bug,priority-high" --json`. The MCP fanout shape is the failure mode, not the absence of capability.

**GitHub Tier 2** (`experiments/github/runs/tier2-n5/findings.md`, `experiments/github/runs/issue-create-n5/findings.md`, `experiments/github/runs/directed-n5/findings.md`)

| Task | baseline | skill (raw / valid) | mcp |
|---|---|---|---|
| `tier2_issue_workflow` | 0/5 | **5/5** / **5/5** | **5/5** |
| `tier2_file_patch_pr` | 0/5 | **5/5** / **0/5** (all INVALID) | **5/5** |
| `tier2_issue_create` | not run | **5/5** / **5/5** | **5/5** |
| `tier2_file_patch_pr_directed` | not run | 3/5 / 2/5 (prompt rewrite shifts but doesn't close the escape) | not applicable |

Both arms produce correct end state on `issue_workflow` and `issue_create`. The split shows up on `file_patch_pr`: **skill stays in surface where `gh` has first-class commands** (`gh issue edit/comment/close`, `gh issue create`) and **always escapes where it doesn't** — `file_patch_pr` needs create-branch-from-SHA and update-file-on-branch, neither of which has a high-level `gh` command, so the agent composes them out of `gh api` + shell variable assignment for the file content payload. All 5 trials hit the same escape. A directed-prompt variant (`tier2_file_patch_pr_directed`) that explicitly names the in-surface workaround halves the escape rate (2/5 valid) but doesn't close it and triples the cost.

**Clean apples-to-apples cost (4 GH tasks):** MCP is 1.13× cheaper on `tier1_workflow_status`, 1.32× on `tier1_pr_diff_answer`, 1.31× on `tier2_issue_create`, and 1.38× on `tier2_issue_workflow`. All four favor MCP; range 1.13×–1.38×. The tightest ratio (workflow_status, 1.13×) is the smallest-payload task — when the call shape and response size are nearly identical, the per-turn-payload gap nearly vanishes.

## Known limits

- **Same controller/agent identity in the n5 run.** Both `GITHUB_CONTROLLER_TOKEN` and `GITHUB_AGENT_TOKEN` resolved to user `chief-builder`. The plan was distinct identities; the n5 measurements still reflect the right tool surface but the env-grep escalation finding has to be read knowing the agent's PAT was the same identity as the controller's PAT.
- **240 s wall budget hits MCP `tier1_issue_triage` hard.** A wider budget at higher N would distinguish "MCP cannot do this" from "MCP needs more time and turns". The current data says only that the failure mode exists and reproduces at N=5.
- **Tempdir filesystem reach.** The trial tempdir is in the same user account as the runner. With `Read`/`Glob` allowed in the baseline arm, an agent could in principle walk `/Users/...`. Per-trial dynamic fixtures + sandbox repos keep answers off the local filesystem so this practical risk is minimal, but the v1 design accepts it.

## Adding a new experiment

1. Create `harness/src/experiments/<name>.ts` exporting an `ExperimentSpec`:
   - `arms`: per-arm `mcpConfig`, `allowedTools`, `disallowedTools`, optional `extraEnv`
   - `classifier`: `intendedMcpPrefix`, `intendedSkillName`, `intendedShellCommand`, `classifyShellCommand`
   - `tasksPath`, and optional `preflight` / `buildAgentEnv` hooks
2. Register it in `harness/src/experiments/index.ts`.
3. Add tasks at `experiments/<name>/tasks/index.ts`.
4. Bundle the skill at `.claude/skills/<skill-name>/SKILL.md` if the skill arm uses one.
5. Run `pnpm harness verify-arms --experiment <name>` before any trials.

All harness code is shared. Per the project rule in `CLAUDE.md`: never fork the harness per experiment.
