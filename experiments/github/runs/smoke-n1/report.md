# Experiment Report: github / smoke-n1 — All Tiers
_Generated: 2026-05-15T12:40:25.194Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

| Task | Tier | Arm | Trials | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_issue_triage | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 19.0 | 42.0 | 0.0s |
| tier1_issue_triage | 1 | skill | 1 | 100% | 100% | 100% | 1.0 | 714 | 64415 | 7999 | 590 | 73718 | 3.0 | 8.0 | 22.8s |
| tier1_issue_triage | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 714 | 49033 | 8205 | 619 | 58571 | 3.0 | 8.0 | 17.7s |
| tier1_pr_diff_answer | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 19.0 | 43.0 | 0.0s |
| tier1_pr_diff_answer | 1 | skill | 1 | 100% | 100% | 100% | 1.0 | 701 | 63948 | 7600 | 451 | 72700 | 3.0 | 6.0 | 17.9s |
| tier1_pr_diff_answer | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 705 | 47645 | 6601 | 518 | 55469 | 3.0 | 8.0 | 24.7s |
| tier1_repo_inventory | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 28.0 | 55.0 | 0.0s |
| tier1_repo_inventory | 1 | skill | 1 | 100% | 0% | 0% | 1.0 | 647 | 83811 | 8716 | 1025 | 94199 | 6.0 | 14.0 | 19.9s |
| tier1_repo_inventory | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 657 | 138793 | 20305 | 2877 | 162632 | 13.0 | 26.0 | 61.0s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 3 | 3 | 0% | 100% | 100% | 0 | 0 | 0 | 0 | 0 | 46.7 |
| skill | 2 | 2 | 100% | 100% | 100% | 708 | 64182 | 7800 | 521 | 73209 | 7.0 |
| mcp | 3 | 3 | 100% | 100% | 100% | 692 | 78490 | 11704 | 1338 | 92224 | 14.0 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 7.0 | 14.0 | 73209 | 92224 | 0.79× | 100% | 100% | Yes |