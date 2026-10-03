# cli-vs-mcp

[![CI](https://github.com/chief-builder/cli-vs-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/chief-builder/cli-vs-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A TypeScript harness that runs the same task many times through **Claude Code** under three tool surfaces and measures
what changes: a **baseline** with no execution tools, a **skill** arm where Claude Code drives a CLI (`playwright-cli`,
`gh`) through a Skill, and an **mcp** arm where it uses an MCP server (`@playwright/mcp`, `github-mcp-server`). Each
trial runs `claude -p` in a fresh temp directory against per-trial synthetic state. The harness records the transcript,
token and time cost, and a success score. It also classifies every tool call as inside or outside the arm's intended
surface, so a trial that "passed" by escaping its tools is not counted as a clean pass.

Write-up and charts: <https://chief-builder.github.io/cli-vs-mcp/>

## Why it matters

"Should I wrap this tool as a CLI skill or an MCP server?" is usually argued from intuition. This harness turns it
into a controlled comparison: same prompt, same per-trial state, same model, with only the tool surface changing.
It reports both **cost** (tokens, turns, time) and **validity** (did the agent stay on the surface it was given). The
second turned out to matter as much as the first. CLI arms frequently reached the right answer through shell escapes
such as `base64 -d`, ad-hoc variables, and in one task borrowed credentials, which a success-only benchmark would
have counted as wins.

## Architecture

```mermaid
flowchart LR
  CLI["pnpm harness run<br/>harness/src/cli.ts"] --> Runner["runTrial<br/>harness/src/runner.ts"]
  Runner -->|"task.setup(seed)"| State["per-trial state<br/>(in memory)"]
  State --> FS["fixture server<br/>127.0.0.1, Playwright"]
  State --> Prov["sandbox repo provisioner<br/>controller token, GitHub"]
  Runner -->|"--tools, --settings, --mcp-config,<br/>scrubbed env, fresh tempdir"| Claude["claude -p<br/>(agent under test)"]
  Claude -->|skill arm| CLIbin["playwright-cli / gh"]
  Claude -->|mcp arm| MCP["@playwright/mcp / github-mcp-server"]
  CLIbin --> FS & GH[(GitHub sandbox org)]
  MCP --> FS & GH
  Prov --> GH
  Claude -->|stream-json| Redact["redact.ts"] --> Metrics["metrics.ts<br/>tokens + surface classifier"]
  Metrics --> Result["runs/RUN/results/*.json"] --> Report["report.ts<br/>markdown tables"]
```

| Module | Responsibility |
|---|---|
| `harness/src/cli.ts` | Commands: `run`, `report`, `recompute-metrics`, `verify-arms`, `redact-artifacts`; argument validation |
| `harness/src/runner.ts` | One trial: temp dir, setup, fixture server, `claude` child with isolation flags and scrubbed env, success check, guaranteed cleanup |
| `harness/src/config.ts` | Defaults (model, timeout, tool lists) and validated GitHub configuration |
| `harness/src/experiment.ts` | `ExperimentSpec` / `ArmConfig` interfaces |
| `harness/src/experiments/{playwright,github}.ts` | Per-experiment arms, shell classifier, agent env, preflight |
| `harness/src/metrics.ts` | Stream-json parser and allow-list tool classifier |
| `harness/src/shell.ts` | Top-level shell segment parser used by the classifiers |
| `harness/src/redact.ts` | Removes home paths and out-of-trial file reads from artifacts |
| `harness/src/report.ts` | Aggregation and markdown report |
| `harness/src/fixtureServer.ts`, `trialState.ts` | Loopback HTTP fixtures and seeded per-trial state |
| `experiments/<name>/tasks/` | Task definitions (prompt, setup, success check, cleanup) |
| `experiments/github/provisioner.ts` | Controller-side GitHub REST helpers |

### How a trial is isolated

1. **Paired seed.** `sha256(experiment:run:task:trial)` (16 hex) drives all per-trial state, so every arm attempting
   trial 3 of a task sees the same data.
2. **Answers stay off disk.** Playwright pages are rendered from memory by a per-trial server on `127.0.0.1`. GitHub
   state lives in a private repo created by a controller token the agent never sees, and is deleted on cleanup.
3. **Positive tool list.** Each arm passes `claude --tools <list>`: baseline `Read Glob Grep Write ToolSearch`, skill
   `Skill Bash Write ToolSearch`, mcp `Write ToolSearch`. MCP tools come only from `--strict-mcp-config --mcp-config`.
   `WebFetch`, `WebSearch`, `Monitor`, `CronCreate` and `RemoteTrigger` are also on `--disallowed-tools`.
4. **File-tool confinement.** A `--settings` deny rule blocks `Read`/`Edit` under `~` and the repo, so an agent can't
   read the developer's files or other trials' results.
5. **Credential isolation.** Every inherited `GH_*`/`GITHUB_*` variable is removed (`extendEnv: false`), `gh` gets an
   empty per-trial `GH_CONFIG_DIR`, and the agent token is injected under the key each arm expects. The GitHub skill
   arm's Bash runs in Claude Code's OS sandbox with no unsandboxed fallback, which blocks the developer's keyring login
   and `$HOME` reads.
6. **Classification.** Each tool call is checked against the same per-arm list; Bash calls in the skill arm must consist
   only of the intended CLI (no pipes into helpers, no `$(...)`, no variable assignments).

`pnpm harness verify-arms --experiment <name>` starts each arm exactly like a trial and prints the tool list Claude
Code reports, and exits non-zero if anything outside the configured list is present.

## Quickstart

Prerequisites:

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 24 (see `.nvmrc`) | everything |
| pnpm | 12 (`packageManager` in `package.json`; `corepack enable` or `npm i -g pnpm@12`) | everything |
| Claude Code CLI | logged in (`claude` on `PATH`) | `run`, `verify-arms` (each trial is a paid model call) |
| Docker | running | GitHub mcp arm |
| `gh` | any recent | GitHub skill arm |
| macOS or Linux (`bubblewrap` + `socat` on Linux) | | Claude Code's Bash sandbox (GitHub skill arm) |

```bash
git clone https://github.com/chief-builder/cli-vs-mcp.git
cd cli-vs-mcp
pnpm install
pnpm test                                   # no network, no Claude calls
pnpm exec playwright-cli install-browser    # first time on a machine

# Check arm isolation, then run one trial per arm (about 3 short Claude calls each)
pnpm harness verify-arms --experiment playwright
pnpm harness run --experiment playwright --run quickstart --arm skill --task tier1_scrape --trials 1
pnpm harness run --experiment playwright --run quickstart --arm mcp --task tier1_scrape --trials 1
pnpm harness report --experiment playwright --run quickstart
```

A full N=5 run of one experiment is several hundred `claude -p` calls. Budget accordingly.

### GitHub experiment

Create a dedicated sandbox org and two fine-grained PATs scoped to it, then put them in `.env` at the repo root
(gitignored and loaded automatically by `pnpm harness`):

```bash
GITHUB_SANDBOX_OWNER=my-sandbox-org
GITHUB_CONTROLLER_TOKEN=github_pat_...   # Administration, Contents, Issues, Pull requests, Workflows: write
GITHUB_AGENT_TOKEN=github_pat_...        # Tier 1: Metadata, Contents, Issues, Pull requests, Actions: read
                                         # Tier 2 (github-rw): Contents, Issues, Pull requests: write
```

```bash
docker pull ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4
pnpm harness verify-arms --experiment github
pnpm harness run --experiment github    --run myrun --arm skill --tier 1 --trials 5
pnpm harness run --experiment github-rw --run myrun --arm mcp   --tier 2 --trials 5
```

Use a separate GitHub identity for the agent token if you can. The n5 runs used the same user for both tokens.

## Configuration

| Setting | Where | Default | Notes |
|---|---|---|---|
| `GITHUB_SANDBOX_OWNER` | env / `.env` | required for GitHub | User or org that owns throwaway repos |
| `GITHUB_CONTROLLER_TOKEN` | env / `.env` | required for GitHub | Provisions and deletes repos; never passed to the agent |
| `GITHUB_AGENT_TOKEN` | env / `.env` | required for GitHub | Given to the agent as `GH_TOKEN`/`GITHUB_TOKEN` (skill) or `GITHUB_PERSONAL_ACCESS_TOKEN` (mcp) |
| `GITHUB_HOST` | env / `.env` | `api.github.com` | API host for the provisioner; forwarded to the agent as `GH_HOST`/`GITHUB_HOST` |
| `LOG_FORMAT` | env | human | `json` for one JSON object per log line |
| `--model` | `run`, `verify-arms` | `claude-sonnet-4-6` | `DEFAULT_MODEL` in `harness/src/config.ts` |
| Trial timeout | `harness/src/config.ts` | 240 s | `TRIAL_TIMEOUT_MS` |
| Arm tool lists, sandbox hosts | `harness/src/experiments/*.ts` | see above | `ArmConfig.tools`, `sandboxNetwork` |
| MCP servers | `.mcp.playwright.json`, `.mcp.github.{ro,rw}.json` | pinned versions | `@playwright/mcp@0.0.75`; `github-mcp-server` v1.0.4 by digest |

Commands (`pnpm harness <cmd> --help` for details):

| Command | Required | Optional |
|---|---|---|
| `run` | `--experiment --run --arm --trials` | `--tier <1-3>` or `--task <id>`; `--model`; `--single-cli-command` |
| `report` | `--experiment --run` | `--tier` or `--all-tiers`; `--crossover-analysis`; `--single-cli-command`; `--include-cost`; `--output <path>` |
| `verify-arms` | `--experiment` | `--arm`; `--model` |
| `recompute-metrics` | `--experiment --run` | `--arm`; `--tier` (re-parses stored transcripts; use `github-rw --tier 2` for Tier 2 GitHub results) |
| `redact-artifacts` | | `--experiment` |

Results are written to `experiments/<exp>/runs/<run>/results/<arm>/<task>/<n>.json` with the transcript at
`.../transcripts/<arm>/<task>/<n>.jsonl`. Result fields are defined by `TrialResult` (`harness/src/runner.ts`) and
`Metrics` (`harness/src/metrics.ts`). A trial killed on timeout has `metrics.incomplete: true`, and its tokens are a
lower-bound estimate (`tokensEstimated: true`).

## Tasks

**Playwright** (`experiments/playwright/tasks/`): `tier1_login` (sign in, screenshot ≥ 1 KB), `tier1_scrape` (5-row
table to JSON), `tier1_form` (submit a form with a per-trial nonce), `tier1_products` (5 product pages to JSON),
`tier2_checkout` (find a product by marker, check out), `tier2_recovery` (read an inline error code and resubmit).

**GitHub** (`experiments/github/tasks/`): Tier 1 read-only: `tier1_repo_inventory`, `tier1_issue_triage`,
`tier1_pr_diff_answer`, `tier1_workflow_status`. Tier 2 (`--experiment github-rw`): `tier2_issue_workflow`,
`tier2_file_patch_pr`, `tier2_file_patch_pr_directed`, `tier2_issue_create`.

## Results (N=5)

All figures are regenerated from the committed result JSON (`experiments/*/runs/*/findings.md`). Token figures are
total tokens (input + cache read + cache creation + output) averaged over valid-surface trials.

**Playwright** (`experiments/playwright/runs/n5/findings.md`)

| Tier | baseline | skill | mcp | Skill/MCP tokens |
|---|---|---|---|---|
| 1 | 0/20 | 20/20 | 20/20 | 1.64× |
| 2 | 0/10 | 10/10 | 7/10 (`tier2_recovery` 2/5) | 1.86× (1.52× on completed trials) |

MCP used fewer tokens on every Playwright task (per-task 1.29×–1.42×, except `tier1_form` at 2.51×, where the skill arm
filled fields one `fill` call at a time and MCP used one `browser_fill_form`). The three failed MCP `tier2_recovery`
trials stalled after at most 4 tool calls and were killed at 240 s; the transcripts don't show why.

**GitHub, clean comparisons** (both arms passed and stayed in surface)

| Task | Skill/MCP tokens |
|---|---|
| `tier1_workflow_status` | 1.13× |
| `tier1_pr_diff_answer` | 1.32× |
| `tier2_issue_create` | 1.31× |
| `tier2_issue_workflow` | 1.38× |

**GitHub, validity findings**

- `tier1_repo_inventory` and `tier2_file_patch_pr`: skill passed 5/5 but **0/5 stayed in surface** (`gh api … | base64 -d`
  to decode file content; shell variables to build the PUT body). MCP passed 5/5 in surface.
- `tier2_file_patch_pr_directed`: naming the in-surface workaround in the prompt gave 3/5 pass, 2/5 in surface, and only
  1/5 both. Passing trials cost about 2.45× the undirected run's tokens.
- `tier1_issue_triage` is **not a valid comparison**. The n5 agent token lacked Issues read access, so every issue call
  returned 403 in both arms. MCP timed out 5/5. The skill arm "passed" 5/5 only by using the controller token (3 trials)
  or the developer's own `gh` login (2 trials). That was possible because the environment scrub did not take effect at
  the time; it is fixed now (see [SECURITY.md](SECURITY.md)).

## Project status and limitations

This is a research harness, not a benchmark suite. Read the results with these limits in mind:

- **N=5 per cell.** Treat the ratios as directional rather than precise.
- **Isolation changed after the data was collected.** The committed n5 runs used Claude Code 2.1.142–2.1.143 with the
  older isolation, in which `--allowed-tools` did not restrict tools and the env scrub did not apply. Results were
  re-classified with the current allow-list classifier. Re-running under the current isolation is an open item.
- **Experiment subjects are pinned on purpose.** These are `@playwright/cli` 0.1.13, `@playwright/mcp` 0.0.75,
  `github-mcp-server` v1.0.4 and model `claude-sonnet-4-6`. Newer versions exist, and upgrading them requires a new run.
  Claude Code itself is not pinned; record `claude --version` with any new run.
- **MCP protocol version.** The harness does not implement MCP; Claude Code is the client. The negotiated protocol
  version is not recorded. The current specification revision is 2026-07-28.
- **Same identity.** In the n5 runs the controller and agent tokens belonged to the same GitHub user.
- **Sandbox coverage.** Only the GitHub skill arm runs Bash in the OS sandbox. The Playwright skill arm needs local
  browsers and a loopback server, so it relies on the classifier and file-tool deny rules.
- **File-tool reach.** Reads are denied under `~` and the repo, but not elsewhere (for example the user's `$TMPDIR`).
  Answers are never on disk, and such reads are redacted from artifacts; full confinement needs a container.
- **macOS sandbox setting.** The GitHub skill arm sets `enableWeakerNetworkIsolation` so `gh` can verify TLS (without
  it every `gh` call fails with `x509: OSStatus -26276`). The keychain and `$HOME` stay blocked; this was tested.
- **Timeouts.** Token counts for killed trials are lower bounds (streamed output tokens are partial and side-model calls
  are missing).

## Development

```bash
pnpm test            # vitest: unit + integration (fake claude), no network
pnpm test:coverage   # with v8 coverage
pnpm lint            # eslint
pnpm format:check    # prettier
pnpm typecheck       # tsc --noEmit
pnpm check           # all of the above
```

To add an experiment, create `harness/src/experiments/<name>.ts` exporting an `ExperimentSpec` (arms with `tools`,
`mcpConfig`, optional `sandboxNetwork`/`extraEnv`; a classifier; `tasksPath`; optional `preflight`/`buildAgentEnv`),
register it in `harness/src/experiments/index.ts`, add tasks under `experiments/<name>/tasks/`, bundle any skill under
`.claude/skills/<skill>/`, and run `verify-arms`. The harness is shared; don't fork it per experiment. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). `.claude/skills/playwright-cli/` is adapted from `@playwright/cli` (Apache-2.0); see [NOTICE](NOTICE).
