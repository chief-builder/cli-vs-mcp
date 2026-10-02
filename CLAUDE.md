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

Each trial runs `claude -p` in a **fresh tempdir** with a tightly curated flag set (`buildClaudeArgs` in `harness/src/runner.ts`):

- `--tools <list>` is the positive list of built-in tools (`ArmConfig.tools`). `--allowed-tools` does NOT restrict anything under `bypassPermissions`; don't rely on it.
- `--strict-mcp-config --mcp-config <file-or-inline>` controls MCP exposure
- `--disallowed-tools` repeats the always-blocked list as a second guard
- `--settings` denies `Read`/`Edit` under `~` and the repo; arms with `sandboxNetwork` (GitHub skill) also run Bash in Claude Code's OS sandbox with no unsandboxed fallback
- `--setting-sources project,local` strips the user's skill set
- `--permission-mode bypassPermissions` for non-interactive runs

Always blocked across every arm: `WebFetch`, `WebSearch`, `Monitor`, `CronCreate`, `RemoteTrigger` — each is an out-of-band execution or fetch channel that agents will use to bypass blocked Bash. The classifier in `metrics.ts` is an allow-list derived from the same `ArmConfig.tools`, so keep the two in one place.

After changing arm config, run `pnpm harness verify-arms --experiment <name>`; it prints the tools Claude Code actually exposes and fails on anything unexpected.

## Running

```bash
# arm isolation smoke
pnpm harness verify-arms --experiment playwright
pnpm harness verify-arms --experiment github

# Playwright trials
pnpm harness run --experiment playwright --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 1 --trials 1

# GitHub trials (GITHUB_* vars in .env, loaded automatically — see README)
pnpm harness run --experiment github --run smoke-n1 --arm skill --tier 1 --trials 1

# Report
pnpm harness report --experiment playwright --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/playwright/runs/smoke-n1/report.md   # findings.md holds hand-written narrative
```

## Rules

- All harness code is shared across experiments. To add a new tool-surface comparison, create one file under `harness/src/experiments/` and add it to the registry — do not fork the harness.
- Per-experiment task definitions go in `experiments/<name>/tasks/` only.
- Never write tokens into transcripts, result JSON, or trial workdirs. The runner removes every inherited `GH_*`/`GITHUB_*` env var (with `extendEnv: false`, so execa can't merge them back), points `GH_CONFIG_DIR` at an empty per-trial dir, and per-arm `buildAgentEnv` injects the right keys back in.
- The runner redacts home paths and out-of-trial file reads from every artifact it writes. Use `pnpm harness redact-artifacts` before committing runs produced by older code.
- Run `pnpm check` (typecheck, lint, format, tests) before committing.
