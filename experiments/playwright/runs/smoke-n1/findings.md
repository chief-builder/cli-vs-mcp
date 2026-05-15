# Playwright Smoke (smoke-n1) — Findings

- **Run**: `smoke-n1` (N=1 per task per arm)
- **Generated**: 2026-05-15
- **Model**: `claude-sonnet-4-6`
- **Tier 1 tasks**: `tier1_login`, `tier1_scrape`, `tier1_form`, `tier1_products`
- **Tier 2 tasks**: `tier2_checkout`, `tier2_recovery`
- **Per-trial timeout**: 180 s (`runner.ts:TRIAL_TIMEOUT_MS`)

## Headline numbers

| Tier | Arm | Success | Valid surface | Avg total tokens | Avg turns |
|---|---|---:|---:|---:|---:|
| 1 | baseline | 0/4 | n/a (no execution) | — | 38.0 |
| 1 | skill    | **4/4** | 4/4 | **232,943** | 16.5 |
| 1 | mcp      | **4/4** | 4/4 | **127,922** | 15.0 |
| 2 | baseline | 0/2 | n/a (no execution) | — | 35.5 |
| 2 | skill    | 1/2 | 1/2 valid (1 timeout) | — | 17.5 |
| 2 | mcp      | **2/2** | 2/2 | **201,179** | 23.0 |

## What the numbers say

**Tier 1 — read-only browser tasks (all four passed for both browser arms):**

- Skill uses **1.82× the tokens** of MCP at the same success rate (232k vs 128k average per task). The reasonable model: each Skill step is two tool calls (action + explicit `playwright-cli snapshot`), while MCP bundles the post-action snapshot inline. This matches the prior methodology direction.
- Turn counts are nearly identical (16.5 skill vs 15.0 mcp). The cost gap is per-turn payload, not extra steps.
- Wall-clock differs more sharply: skill averages ~53 s/task, mcp ~25 s/task at Tier 1. MCP's bundled snapshots cut round-trips through the Skill wrapper.

**Tier 2 — multi-step / mutation:**

- MCP completed both `tier2_checkout` (47.8 s, 240k tokens) and `tier2_recovery` (29.4 s, 162k tokens) cleanly.
- Skill **timed out** on `tier2_checkout` and on `tier2_recovery` (the latter's `successCheck` passed because the agent did write the expected artifact before the 180 s kill, but the `result` event never reached the transcript so token totals show as 0 in the per-task table). Both of these would benefit from a longer wall-clock budget at higher N before drawing a Tier 2 conclusion.
- **Baseline** sat at 0/2 with both trials hitting the 180 s timeout — exactly what we want from a no-execution arm.

**Validity surface:** every browser-arm trial that produced a transcript stayed on its intended surface. No `WebFetch` / `WebSearch` / `Bash`-escape / `mcp__playwright__*`-leak escapes were observed. The `Single CLI Cmd` column for skill is 75% at Tier 1 — the agent chained multiple `playwright-cli` calls in some Bash invocations, which is valid in `practical` mode and would be flagged invalid in `research-single` mode.

## Caveats

- **N=1 is a smoke matrix**, not a benchmark. The 1.82× token ratio at Tier 1 is suggestive but should be re-measured at N≥3 before being cited.
- **Tier 2 skill timeouts** are the most important finding to follow up on. Either the 180 s budget is too tight for chained `playwright-cli` flows, or the skill genuinely needs more steps to recover from snapshot-driven element refs in a multi-page workflow. Either way, the right next move is a higher timeout and N=3.
- **Token aggregation skips invalid/timeout trials** in the per-tier summary, so the Tier 2 skill row reads `0` for tokens — that's correct accounting (no completed `result` event), not zero usage.

## Reproducing

```bash
pnpm harness run --experiment playwright --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 1 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm skill    --tier 2 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm mcp      --tier 2 --trials 1
pnpm harness run --experiment playwright --run smoke-n1 --arm baseline --tier 2 --trials 1
pnpm harness report --experiment playwright --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/playwright/runs/smoke-n1/findings.md
```

See `report.md` in the same directory for the raw per-task table and crossover analysis.
