# CLI vs MCP Experiments

Compares Claude Code performance against three tool-surface arms on the same task:

- `baseline` — no execution surface (pure reasoning floor)
- `skill` — a Claude Code Skill that wraps a CLI binary
- `mcp` — an MCP server providing structured tools

Two experiments are implemented:

- **playwright** — browser automation: `playwright-cli` skill vs `@playwright/mcp` MCP server
- **github** — GitHub state: `gh` CLI skill vs `github-mcp-server` MCP server

## Structure

- `harness/src/` — shared TypeScript harness (runner, classifier, report, CLI). **Never fork per experiment.**
  - `experiment.ts` — `ExperimentSpec` interface (arms, classifier, preflight, agent env, tasks path)
  - `experiments/playwright.ts`, `experiments/github.ts` — per-experiment specs
  - `metrics.ts` — transcript parser; takes the active experiment's classifier
  - `runner.ts` — per-trial tempdir + fixture server + claude exec
- `experiments/<name>/` — per-experiment task definitions, fixtures, and run artifacts
  - `tasks/index.ts` exports `tasks: Task[]` used by the harness
  - `fixtures/` — static HTML templates for Playwright; not used by GitHub
  - `runs/<name>/results/<arm>/<task_id>/<n>.json` — per-trial result JSON
  - `runs/<name>/transcripts/<arm>/<task_id>/<n>.jsonl` — raw stream-json transcripts
- `.claude/skills/<skill-name>/` — project-level Skills, copied into each trial's tempdir when the skill arm runs
- `.mcp.playwright.json`, `.mcp.github.ro.json`, `.mcp.github.rw.json` — per-experiment MCP server configs

## Arm isolation

Each trial runs `claude -p` in a **fresh tempdir** with a tightly curated flag set:

- `--strict-mcp-config --mcp-config <file-or-inline>` controls MCP exposure
- `--allowed-tools <list>` is a positive allow-list
- `--disallowed-tools <list>` blocks per-arm shortcuts
- `--setting-sources project,local` strips the user's skill set
- `--permission-mode bypassPermissions` for non-interactive runs

Always blocked across every arm: `WebFetch`, `WebSearch`, `Monitor`, `CronCreate`, `RemoteTrigger` — each is an out-of-band execution or fetch channel that agents will use to bypass blocked Bash.

## Running

```bash
# arm isolation smoke
pnpm harness verify-arms --experiment playwright
pnpm harness verify-arms --experiment github

# Playwright trials
pnpm harness run --experiment playwright --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 1 --trials 1

# GitHub trials (requires sandbox env vars — see README)
GITHUB_AGENT_TOKEN=... GITHUB_CONTROLLER_TOKEN=... GITHUB_SANDBOX_OWNER=cli-vs-mcp-lab \
  pnpm harness run --experiment github --run smoke-n1 --arm skill --tier 1 --trials 1

# Report
pnpm harness report --experiment playwright --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/playwright/runs/smoke-n1/findings.md
```

## Rules

- All harness code is shared across experiments. To add a new tool-surface comparison, create one file under `harness/src/experiments/` and add it to the registry — do not fork the harness.
- Per-experiment task definitions go in `experiments/<name>/tasks/` only.
- Never write tokens into transcripts, result JSON, or trial workdirs. The runner scrubs inherited `GH_*`/`GITHUB_*` env vars before launching every child claude process; per-arm `buildAgentEnv` injects the right keys back in.
