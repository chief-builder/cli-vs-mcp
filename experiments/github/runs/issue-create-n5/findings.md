# Experiment Report: github / issue-create-n5 — Tier 2
_Generated: 2026-05-17T17:35:31.445Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

| Task | Tier | Arm | Trials | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier2_issue_create | 2 | skill | 5 | 100% | 100% | 100% | 1.0 | 561 | 45498 | 7282 | 419 | 53760 | 2.0 | 5.2 | 13.0s |
| tier2_issue_create | 2 | mcp | 5 | 100% | 100% | 100% | 1.0 | 561 | 33882 | 6296 | 431 | 41169 | 2.0 | 5.8 | 10.6s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 2

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| skill | 1 | 5 | 100% | 100% | 100% | 561 | 45498 | 7282 | 419 | 53760 | 5.2 |
| mcp | 1 | 5 | 100% | 100% | 100% | 561 | 33882 | 6296 | 431 | 41169 | 5.8 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 2 | 5.2 | 5.8 | 53760 | 41169 | 1.31× | 100% | 100% | Yes |
## Narrative

**Run config.** N=5, skill and mcp arms only, github-rw experiment. Designed as a clean apples-to-apples single-primitive write comparison — `gh issue create` on the skill side, `issue_write` (create variant) on the MCP side. No baseline arm because we already know baseline is 0/N on off-host state.

**Headline.**

| Arm | Pass | Valid | Avg total tok | Avg turns | Avg wall |
|---|---:|---:|---:|---:|---:|
| skill | 5/5 | 5/5 | 53,760 | 5.2 | 13.0 s |
| mcp   | 5/5 | 5/5 | 41,169 | 5.8 | 10.6 s |

Skill/MCP token ratio: **1.31×**. Clean apples-to-apples; the cost gap is per-turn payload, not extra steps (MCP averages ~0.6 more turns than skill on this task).

**Tool sequences are nearly identical in shape.**

- Skill: `Skill` (load gh skill) → `Bash gh issue create --title ... --body ... --label bug --label priority-high`. Two tool calls.
- MCP: `ToolSearch` (load issue_write schema) → `mcp__github__issue_write (method=create, title=..., body=..., labels=[bug, priority-high])`. Two tool calls.

The cost difference reduces to "the bash command's stdout (issue URL + sometimes a small banner) is slightly bigger than the MCP tool result (a tight JSON object)." Same primitive on both sides, same number of round-trips, modest constant-factor payload difference.

**Pattern consistency.** With this task included, the clean apples-to-apples GH comparisons read:

| Task | Skill/MCP |
|---|---:|
| `tier1_pr_diff_answer` | 1.32× |
| `tier2_issue_workflow`  | 1.38× |
| `tier2_issue_create`    | 1.31× |

Three data points, range 1.31×–1.38×, all favoring MCP. Combined with the Playwright clean tasks (1.29×–1.42× on five of six tasks), the directional claim "MCP is ~1.3–1.4× cheaper than the CLI skill when both arms have a clean primitive for the task" is now supported by 8 of 10 clean cross-domain comparisons.

**Caveat.** A race-condition fix was applied during this run: the original successCheck listed open issues immediately after the agent created one, but `GET /repos/{repo}/issues?state=open` has measurable eventual-consistency lag — direct probe showed `issue.state=open` on the create response while the list returned 0 issues. Initial N=5 run scored 0/5 skill / 1/5 mcp purely from this race; after adding a 6×500 ms retry loop to the successCheck, both arms scored 5/5. This is the third eventual-consistency race the harness has hit on GitHub (after the provisioner branch-ref race and the contents-by-ref race during n5). Pattern: any read-after-write on the GitHub REST API needs a retry budget.
