# GitHub Experiment — Status

**Tier 1 smoke executed (`smoke-n1`, N=1, all 3 arms).** See `runs/smoke-n1/findings.md`.

Headline: skill **0.79× MCP tokens** on Tier 1 — opposite of Playwright, because `gh --json --jq` projects minimal field sets while MCP returns full structured responses. Both browser arms pass 3/3. Baseline 0/3 (timeouts; GitHub state is off-host so the no-execution arm hard-fails as designed).

## What ships

- `harness/src/experiments/github.ts` — arm definitions, classifier (with Tier 1 read-only mode), env scrubbing, per-arm agent-token routing
- `harness/src/experiments/index.ts` — `github` and `github-rw` registered
- `.mcp.github.ro.json`, `.mcp.github.rw.json` — pinned to `ghcr.io/github/github-mcp-server@sha256:e3816a47…`
- `.claude/skills/github-cli/SKILL.md` — `Bash(gh:*)`-scoped skill teaching `--json` / `--jq` / `--paginate` and the `gh api` escape valve (with the implicit-POST gotcha)
- `experiments/github/provisioner.ts` — controller-side REST helpers (provisionRepo, repoNameFor, delete-on-cleanup)
- `experiments/github/tasks/tier1.ts` — three Tier 1 read-only tasks
- `experiments/github/runs/smoke-n1/` — completed run artifacts (results, transcripts, findings, report)

## What's verified

- `pnpm typecheck` clean.
- `pnpm harness verify-arms --experiment github` resolves correctly for all 3 arms.
- 9/9 trials produced result JSON. 6/9 passed (3 skill + 3 mcp), 3/9 expected failures (baseline timeouts).
- One classifier-flagged escape in skill arm: agent piped `gh api ... --jq '.content' | base64 -d` to decode README content. Genuine finding documented in findings.md.

## To re-run or extend

```bash
export GITHUB_CONTROLLER_TOKEN=ghp_...    # held by harness, never given to the agent
export GITHUB_AGENT_TOKEN=ghp_...         # read-only for tier1; per-arm env injection routes the right key
export GITHUB_SANDBOX_OWNER=chief-builder-lab

docker pull ghcr.io/github/github-mcp-server:latest

pnpm harness verify-arms --experiment github
pnpm harness run --experiment github --run smoke-n3 --arm skill    --tier 1 --trials 3
pnpm harness run --experiment github --run smoke-n3 --arm mcp      --tier 1 --trials 3
pnpm harness run --experiment github --run smoke-n3 --arm baseline --tier 1 --trials 3
pnpm harness report --experiment github --run smoke-n3 --all-tiers --crossover-analysis \
  --output experiments/github/runs/smoke-n3/findings.md
```

## Tier 2 status

Tier 2 mutation tasks (`tier2_issue_workflow`, `tier2_pr_review`, `tier2_file_patch_pr`, etc. — see `docs/github_mcp_vs_cli_plan.md`) are not yet implemented. The harness supports them — `--experiment github-rw` selects the read-write spec with the write-tools allow-list and the `--read-only` flag dropped from the MCP server. Implementing the tasks themselves is the next milestone.

## Security note

The smoke run used a fine-grained PAT minted at the user level (`chief-builder`) with resource owner `chief-builder-lab`. Both tokens were stored in `.env` (gitignored) and **should be revoked now that the smoke is complete**: https://github.com/settings/personal-access-tokens — the controller token and the agent token are listed separately.
