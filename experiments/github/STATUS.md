# GitHub Experiment — Status

**Framework only.** No live run has been executed in this project.

The GitHub experiment ships scaffolded and wired into the harness, but no trial has been executed because running it requires GitHub credentials and a sandbox owner (an account or org used only for these experiments). The first run requires deliberate setup by the operator.

## What ships in this project

- `harness/src/experiments/github.ts` — arm definitions (`baseline`, `skill`, `mcp`), classifier, env scrubbing, agent-token routing per arm
- `harness/src/experiments/index.ts` — `github` and `github-rw` registered
- `.mcp.github.ro.json`, `.mcp.github.rw.json` — pinned to `ghcr.io/github/github-mcp-server:latest`, served from a `--read-only` and read-write Docker container respectively
- `.claude/skills/github-cli/SKILL.md` — `Bash(gh:*)`-scoped skill teaching `gh`'s `--json` / `--jq` / `--paginate` patterns and the `gh api` escape valve, with the implicit-POST gotcha called out
- `experiments/github/provisioner.ts` — controller-side REST helpers (`provisionRepo`, `repoNameFor`, archive-on-cleanup)
- `experiments/github/tasks/tier1.ts` — three read-only tasks:
  - `tier1_repo_inventory` — describe a private repo (description, topics, default branch, README marker)
  - `tier1_issue_triage` — find one of five issues by per-trial marker
  - `tier1_pr_diff_answer` — name the function added by a single-file PR
- `docs/github_mcp_vs_cli_plan.md` — full plan: authentication model, validity rules, full task suite proposal, risks, milestone gate

## What's verified

- `pnpm typecheck` is clean.
- `pnpm harness verify-arms --experiment github` will fail preflight if `GITHUB_AGENT_TOKEN`, `GITHUB_CONTROLLER_TOKEN`, or `GITHUB_SANDBOX_OWNER` are missing — the right behavior before any live run.

## What's deliberately not done

- No trial has been run. No `experiments/github/runs/` directory exists.
- The MCP arm allow-list (`mcp__github__*`) is hand-curated against the [github/github-mcp-server README](https://github.com/github/github-mcp-server) at write time. Tool names should be re-verified against the actual server output the first time it is launched, because:
  - the server's tool catalogue changes between releases
  - tool names use snake_case with no toolset namespace (e.g. `mcp__github__list_issues`, not `mcp__github__issues__list`)
- The `tier1_pr_diff_answer` provisioner creates a feature branch and uploads an updated file via the Contents API. This pattern has not been exercised end-to-end against a real GitHub account.

## To run the first GitHub smoke

```bash
# 1. Set up a sandbox owner. A dedicated account or org. Don't reuse your personal account.
#    Example: an org named cli-vs-mcp-lab.

# 2. Mint two tokens, both scoped to the sandbox owner only:
#    - Controller token: held by the harness. Permissions to create/seed/archive repos.
#    - Agent token: the only credential the agent sees. Read-only for Tier 1
#      (Contents/Issues/Pull requests/Metadata: read; no write permissions).

export GITHUB_CONTROLLER_TOKEN=ghp_...
export GITHUB_AGENT_TOKEN=ghp_...
export GITHUB_SANDBOX_OWNER=cli-vs-mcp-lab

# 3. Pull the MCP server image.
docker pull ghcr.io/github/github-mcp-server:latest

# 4. Probe the arms first.
pnpm harness verify-arms --experiment github

# 5. Run the smoke.
pnpm harness run --experiment github --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment github --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment github --run smoke-n1 --arm baseline --tier 1 --trials 1

pnpm harness report --experiment github --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/github/runs/smoke-n1/findings.md
```

Expected first-milestone gate (from `docs/github_mcp_vs_cli_plan.md` §"First Milestone Definition"):

- `baseline`: 0/3 pass, 3/3 valid surface
- `skill`: 3/3 pass, 3/3 valid surface, agent token is read-only-scoped
- `mcp`: 3/3 pass, 3/3 valid surface, MCP arm running under `--read-only` config
- 0 cleanup failures across all 9 trials
- 0 controller-token references in any trial artifact or transcript
- `ghAuthLogin` resolves to the configured `expectedAgentLogin` on every trial
