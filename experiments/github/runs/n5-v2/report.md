# Experiment Report: github / n5-v2 — All Tiers
_Generated: 2026-10-03T01:28:34.974Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

_Timed-out trials have no final usage totals. Their tokens are summed from per-message usage, which undercounts output and side-model calls, so averages that include them are lower bounds. Their time is the timeout that killed them._

| Task | Tier | Arm | Trials | Timeouts | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|----------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_issue_triage | 1 | baseline | 2 | 1 | 0% | 100% | 100% | 0.0 | 14 | 308357 | 41625 | 1988 | 351983 | 20.5 | 43.0 | 148.8s |
| tier1_issue_triage | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 7 | 55507 | 10921 | 597 | 67033 | 3.0 | 8.6 | 13.8s |
| tier1_issue_triage | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 8 | 31996 | 7691 | 534 | 40230 | 3.0 | 8.0 | 9.0s |
| tier1_pr_diff_answer | 1 | baseline | 2 | 1 | 0% | 100% | 100% | 0.0 | 18 | 477597 | 40808 | 2757 | 521179 | 22.0 | 46.0 | 164.0s |
| tier1_pr_diff_answer | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 8 | 55323 | 10705 | 528 | 66564 | 3.0 | 7.6 | 10.6s |
| tier1_pr_diff_answer | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 8 | 31409 | 6921 | 502 | 38840 | 3.0 | 7.6 | 12.2s |
| tier1_repo_inventory | 1 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 5 | 19293 | 9538 | 696 | 29531 | 1.5 | 6.0 | 12.8s |
| tier1_repo_inventory | 1 | skill | 5 | 0 | 100% | 0% | 0% | 1.0 | 9 | 73359 | 11428 | 939 | 85734 | 5.2 | 11.8 | 15.9s |
| tier1_repo_inventory | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 8 | 33939 | 9560 | 629 | 44136 | 4.0 | 9.8 | 11.4s |
| tier1_workflow_status | 1 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 4 | 14406 | 5124 | 883 | 20417 | 1.0 | 5.0 | 14.9s |
| tier1_workflow_status | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 8 | 65514 | 10911 | 796 | 77230 | 3.6 | 9.4 | 40.9s |
| tier1_workflow_status | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 8 | 37375 | 12698 | 578 | 50659 | 3.0 | 7.8 | 12.8s |
| tier2_file_patch_pr | 2 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 5 | 19310 | 5099 | 1394 | 25806 | 1.5 | 6.0 | 23.1s |
| tier2_file_patch_pr | 2 | skill | 5 | 0 | 100% | 0% | 0% | 1.0 | 12 | 139138 | 12115 | 1758 | 153022 | 7.8 | 12.8 | 32.3s |
| tier2_file_patch_pr | 2 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 9 | 48703 | 8546 | 1135 | 58394 | 5.0 | 12.6 | 19.8s |
| tier2_file_patch_pr_directed | 2 | skill | 5 | 3 | 40% | 60% | 60% | 0.4 | 12 | 185525 | 16711 | 5481 | 207730 | 9.0 | 19.2 | 213.0s |
| tier2_issue_create | 2 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 4 | 14472 | 4878 | 1353 | 20707 | 1.0 | 4.5 | 22.2s |
| tier2_issue_create | 2 | skill | 5 | 0 | 80% | 100% | 100% | 0.8 | 6 | 37960 | 10102 | 361 | 48429 | 2.0 | 5.8 | 8.3s |
| tier2_issue_create | 2 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 7 | 21616 | 6591 | 408 | 28623 | 2.0 | 6.0 | 7.4s |
| tier2_issue_workflow | 2 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 4 | 14352 | 4975 | 2036 | 21366 | 1.0 | 5.0 | 33.0s |
| tier2_issue_workflow | 2 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 9 | 88807 | 10741 | 695 | 100251 | 5.0 | 10.2 | 18.0s |
| tier2_issue_workflow | 2 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 10 | 46897 | 8600 | 1027 | 56534 | 5.2 | 13.2 | 20.0s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 4 | 8 | 0% | 100% | 100% | 10 | 204913 | 24274 | 1581 | 230778 | 25.0 |
| skill | 3 | 15 | 100% | 100% | 100% | 8 | 58781 | 10846 | 641 | 70276 | 8.5 |
| mcp | 4 | 20 | 100% | 100% | 100% | 8 | 33680 | 9218 | 561 | 43466 | 8.3 |

### Tier 2

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 3 | 6 | 0% | 100% | 100% | 4 | 16044 | 4984 | 1594 | 22626 | 5.2 |
| skill | 3 | 13 | 60% | 100% | 100% | 7 | 64613 | 10673 | 370 | 75663 | 9.0 |
| mcp | 3 | 15 | 100% | 100% | 100% | 9 | 39072 | 7913 | 857 | 47850 | 10.6 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 8.5 | 8.3 | 70276 | 43466 | 1.62× | 100% | 100% | Yes |
| 2 | 9.0 | 10.6 | 75663 | 47850 | 1.58× | 60% | 100% | Yes |