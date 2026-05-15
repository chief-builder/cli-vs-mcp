# cli-vs-mcp

A harness for comparing Claude Code's behavior with three tool surfaces on the same task:

- **`baseline`** — no execution surface. Pure reasoning floor.
- **`skill`** — a Claude Code Skill that wraps a CLI binary.
- **`mcp`** — an MCP server that exposes structured tools.

Two experiments are wired up out of the box.

| Experiment | Skill arm | MCP arm |
|---|---|---|
| `playwright` | `playwright-cli` skill + `Bash(playwright-cli:*)` | [`@playwright/mcp`](https://github.com/microsoft/playwright/tree/main/packages/playwright/src/mcp) |
| `github`     | `github-cli` skill + `Bash(gh:*)`                   | [`ghcr.io/github/github-mcp-server`](https://github.com/github/github-mcp-server) |

Each experiment runs the same prompts through every arm, in fresh per-trial tempdirs, with tight tool allow/deny lists, and records tokens, turns, wall-clock time, success score, and tool-surface validity.

---

## Quick start

```bash
pnpm install
pnpm harness verify-arms --experiment playwright
pnpm harness run --experiment playwright --run smoke-n1 --arm skill --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp   --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 1 --trials 1
pnpm harness report --experiment playwright --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/playwright/runs/smoke-n1/findings.md
```

## Repo layout

```
cli-vs-mcp/
├── harness/src/                         # shared TypeScript harness
│   ├── cli.ts                           # commander entry: run / report / verify-arms / recompute-metrics
│   ├── runner.ts                        # per-trial: tempdir, fixture server, claude exec, env scrub
│   ├── metrics.ts                       # stream-json transcript parser + classifier dispatch
│   ├── experiment.ts                    # ExperimentSpec interface
│   ├── experiments/                     # per-experiment specs (one file each)
│   │   ├── playwright.ts
│   │   ├── github.ts
│   │   └── index.ts                     # registry
│   ├── shell.ts                         # shared shell-segment parser
│   ├── fixtureServer.ts                 # per-trial HTTP server for Playwright fixtures
│   └── trialState.ts                    # paired-seed RNG + per-task state generators
├── experiments/
│   ├── playwright/
│   │   ├── tasks/                       # tier1.ts, tier2.ts, index.ts
│   │   ├── fixtures/                    # HTML templates (no per-trial answers on disk)
│   │   └── runs/<run-name>/             # per-run results + transcripts
│   └── github/
│       ├── tasks/                       # tier1.ts, index.ts
│       ├── provisioner.ts               # controller-side GitHub REST helpers (controller token only)
│       └── runs/<run-name>/
├── .claude/skills/
│   ├── playwright-cli/                  # bundled skill copied into trial tempdirs on `--arm skill`
│   └── github-cli/
├── .mcp.playwright.json                 # @playwright/mcp@0.0.75 stdio config
├── .mcp.github.ro.json                  # github-mcp-server --read-only
├── .mcp.github.rw.json                  # github-mcp-server read-write
└── docs/                                # methodology and findings
```

## How a trial runs

`harness/src/runner.ts:runTrial` performs, for each `(experiment, arm, task, trial)`:

1. Computes a paired seed `(experiment, runName, taskId, trialN) → 16 hex` so every arm sees the same per-trial state.
2. Materializes per-trial state via `task.setup(seed)`. Per-trial answers live in process memory, not on disk.
3. Starts an HTTP fixture server (Playwright) or provisions a sandbox repo (GitHub) — see each experiment.
4. Spawns `claude -p` in a fresh tempdir with arm-specific `--allowed-tools` / `--disallowed-tools` / `--mcp-config` flags. The `GH_*` / `GITHUB_*` env vars are scrubbed before injection; `buildAgentEnv(arm)` repopulates the right key per arm.
5. Captures stream-json stdout to `runs/<run>/transcripts/<arm>/<taskId>/<n>.jsonl`.
6. Runs `task.successCheck(ctx)` against the persisted output dir, plus optional `task.cleanup(state)`.
7. Writes the trial result JSON.

## Validity classifier

`harness/src/metrics.ts:parseTranscript` reads the transcript and, for every `tool_use` event, asks the experiment's classifier whether the call is in-surface for the arm:

- `baseline`: Bash / Skill / Task / Agent / intended MCP prefix are all violations.
- `skill`: Skill must match the experiment's `intendedSkillName`; Bash must match `classifyShellCommand` (which rejects helpers like `curl`, `jq`, `python`, redirections, etc.).
- `mcp`: Bash / Skill / Task / Agent are violations; intended MCP tools are OK.

Always blocked: `WebFetch`, `WebSearch`, `Monitor`, `CronCreate`, `RemoteTrigger` — all are out-of-band execution or fetch channels that agents will use to bypass blocked Bash.

The classifier is the only thing that changes between experiments. Adding a third experiment is one file under `harness/src/experiments/` plus a registry entry.

## Running the Playwright experiment

```bash
pnpm harness verify-arms --experiment playwright

# tier 1 read-only
pnpm harness run --experiment playwright --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 1 --trials 1

# tier 2 multi-step / mutation
pnpm harness run --experiment playwright --run smoke-n1 --arm skill    --tier 2 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp      --tier 2 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 2 --trials 1

pnpm harness report --experiment playwright --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/playwright/runs/smoke-n1/findings.md
```

Playwright tasks: `tier1_login`, `tier1_scrape`, `tier1_form`, `tier1_products`, `tier2_checkout`, `tier2_recovery`. Fixtures are served over HTTP from per-trial dynamic renderers so agents can't bypass the browser by `Read`-ing the source HTML.

## Running the GitHub experiment

The GitHub experiment requires live GitHub state, two distinct tokens, and a sandbox owner. Setup checklist:

1. Create a dedicated sandbox owner — a personal account or org used only for these experiments. Examples: `cli-vs-mcp-lab` (org) or `bot-name` (user).
2. Mint two tokens, scoped to the sandbox owner only:
   - **Controller token** (`GITHUB_CONTROLLER_TOKEN`): held by the harness. Has the permissions needed to create/seed/archive sandbox repos and to verify mutations during `successCheck`. Never exposed to the agent.
   - **Agent token** (`GITHUB_AGENT_TOKEN`): the only credential the agent sees. For Tier 1 read-only runs this must be a **read-only** PAT (Contents/Issues/PRs/Metadata: read; no write permissions). Tier 2+ runs need write permissions on the specific resources you exercise.
3. Pull the MCP server image: `docker pull ghcr.io/github/github-mcp-server:latest`.
4. Run:

```bash
export GITHUB_CONTROLLER_TOKEN=ghp_...    # controller, never leaves the harness
export GITHUB_AGENT_TOKEN=ghp_...         # read-only for tier1; written into the child env per arm
export GITHUB_SANDBOX_OWNER=cli-vs-mcp-lab

pnpm harness verify-arms --experiment github
pnpm harness run --experiment github --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment github --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment github --run smoke-n1 --arm baseline --tier 1 --trials 1
pnpm harness report --experiment github --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/github/runs/smoke-n1/findings.md
```

GitHub Tier 1 tasks (`experiments/github/tasks/tier1.ts`):

- `tier1_repo_inventory` — provisions a private repo with description, topics, and a hidden README marker; agent reports the metadata as JSON.
- `tier1_issue_triage` — provisions a repo with 5 issues (1 target with a hidden marker, 4 decoys); agent finds the target.
- `tier1_pr_diff_answer` — provisions a repo with a single PR adding one new function; agent reports the function name from the diff.

Each task provisions its own sandbox repo via the controller token and archives it on `cleanup`. Repo names are derived from the paired seed (`clivsmcp-<task>-<seed8>`) so a separate admin sweep can delete archived sandbox repos older than N days. Use **archive, not delete** in `cleanup` — fine-grained PATs typically lack delete-repo permission, so relying on delete creates a permission cliff.

## Available CLI commands

```
pnpm harness run                --experiment <name> --run <name> --arm <arm> --tier <n>|--task <id> --trials <n>
pnpm harness report             --experiment <name> --run <name> [--tier <n>|--all-tiers] [--crossover-analysis]
pnpm harness verify-arms        --experiment <name>
pnpm harness recompute-metrics  --experiment <name> --run <name> [--arm <arm>]
```

## Adding a new experiment

1. Create `harness/src/experiments/<name>.ts` exporting an `ExperimentSpec`:
   - `arms`: per-arm `mcpConfig`, `allowedTools`, `disallowedTools`, optional `extraEnv`
   - `classifier`: `intendedMcpPrefix`, `intendedSkillName`, `intendedShellCommand`, `classifyShellCommand`
   - `tasksPath`: path to `experiments/<name>/tasks/index.js`
   - optional `preflight` to assert credentials, `buildAgentEnv` to inject per-arm env
2. Register it in `harness/src/experiments/index.ts`.
3. Add tasks in `experiments/<name>/tasks/*.ts` exporting `tasks: Task[]`.
4. If your skill bundle isn't already there, add `.claude/skills/<skill-name>/SKILL.md`.
5. Run `pnpm harness verify-arms --experiment <name>` first; only then run trials.

## Pinned versions

- `@playwright/mcp@0.0.75` (via `.mcp.playwright.json`)
- `@playwright/cli@0.1.13` (project devDep, provides the `playwright-cli` binary the skill calls)
- `ghcr.io/github/github-mcp-server:latest` (pin to a digest in `.mcp.github.*.json` for reproducibility)
- `gh` CLI version is checked at trial-time and recorded in result JSON

## Status of the two experiments in this checkout

- **Playwright — smoke run complete.** N=1 across 4 Tier 1 tasks + 2 Tier 2 tasks × 3 arms (18 trials). Tier 1 skill **1.82× MCP tokens** at 100% success. See `experiments/playwright/runs/smoke-n1/findings.md`.
- **GitHub — Tier 1 smoke run complete.** N=1 across 3 Tier 1 tasks × 3 arms (9 trials). Tier 1 skill **0.79× MCP tokens** at 100% success — opposite of Playwright, because `gh --json --jq` projects minimal output. See `experiments/github/runs/smoke-n1/findings.md`.

## Docs

- `docs/playwright_methodology.md` — Playwright experiment design and the why behind each arm restriction
- `docs/github_mcp_vs_cli_plan.md` — GitHub experiment plan (authentication model, classifier rules, task suite, risks)
- `experiments/playwright/runs/smoke-n1/findings.md` — Playwright smoke-run findings
- `experiments/github/STATUS.md` — GitHub framework-only status and run prerequisites
