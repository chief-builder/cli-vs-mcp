# Experiment Report: playwright / n5-v2 — All Tiers
_Generated: 2026-10-03T01:28:34.612Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

_Timed-out trials have no final usage totals. Their tokens are summed from per-message usage, which undercounts output and side-model calls, so averages that include them are lower bounds. Their time is the timeout that killed them._

| Task | Tier | Arm | Trials | Timeouts | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|----------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_form | 1 | baseline | 2 | 2 | 0% | 100% | 100% | 0.0 | 24 | 806395 | 75499 | 192 | 882109 | 33.0 | 75.5 | 240.0s |
| tier1_form | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 17 | 226959 | 12877 | 1365 | 241219 | 12.6 | 18.8 | 43.5s |
| tier1_form | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 13 | 80947 | 8386 | 946 | 90291 | 7.6 | 13.6 | 22.7s |
| tier1_login | 1 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 5 | 24459 | 5785 | 1395 | 31644 | 2.0 | 7.5 | 24.6s |
| tier1_login | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 14 | 150023 | 13363 | 1070 | 164470 | 8.6 | 13.6 | 39.0s |
| tier1_login | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 12 | 70636 | 8001 | 957 | 79605 | 6.8 | 13.6 | 19.6s |
| tier1_products | 1 | baseline | 2 | 2 | 0% | 100% | 100% | 0.0 | 34 | 1613921 | 100346 | 376 | 1714676 | 43.5 | 88.5 | 240.0s |
| tier1_products | 1 | skill | 5 | 0 | 100% | 100% | 0% | 1.0 | 17 | 218094 | 12794 | 1669 | 232574 | 12.2 | 17.4 | 47.7s |
| tier1_products | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 19 | 141683 | 8472 | 1371 | 151545 | 14.0 | 21.4 | 30.3s |
| tier1_scrape | 1 | baseline | 2 | 0 | 0% | 100% | 100% | 0.0 | 11 | 117022 | 20858 | 4044 | 141935 | 9.0 | 22.5 | 71.1s |
| tier1_scrape | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 9 | 69576 | 11135 | 744 | 81464 | 4.0 | 8.0 | 15.4s |
| tier1_scrape | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 11 | 44794 | 7154 | 785 | 52744 | 4.6 | 9.4 | 13.4s |
| tier2_checkout | 2 | baseline | 2 | 2 | 0% | 100% | 100% | 0.0 | 28 | 803242 | 74354 | 320 | 877944 | 37.5 | 72.0 | 240.0s |
| tier2_checkout | 2 | skill | 5 | 0 | 100% | 100% | 20% | 1.0 | 19 | 250817 | 13785 | 1453 | 266073 | 13.6 | 21.0 | 42.9s |
| tier2_checkout | 2 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 19 | 146955 | 9702 | 1284 | 157959 | 13.2 | 21.8 | 29.2s |
| tier2_recovery | 2 | baseline | 2 | 2 | 0% | 100% | 100% | 0.0 | 30 | 1357488 | 93406 | 314 | 1451238 | 39.0 | 83.0 | 240.0s |
| tier2_recovery | 2 | skill | 5 | 0 | 100% | 100% | 80% | 1.0 | 17 | 222428 | 12920 | 1486 | 236852 | 12.4 | 20.6 | 42.2s |
| tier2_recovery | 2 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 15 | 105636 | 8436 | 1031 | 115117 | 10.0 | 16.2 | 23.2s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 4 | 8 | 0% | 100% | 100% | 18 | 640449 | 50622 | 1502 | 692591 | 48.5 |
| skill | 4 | 20 | 100% | 100% | 75% | 14 | 166163 | 12542 | 1212 | 179932 | 14.4 |
| mcp | 4 | 20 | 100% | 100% | 100% | 14 | 84515 | 8003 | 1015 | 93546 | 14.5 |

### Tier 2

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 2 | 4 | 0% | 100% | 100% | 29 | 1080365 | 83880 | 317 | 1164591 | 77.5 |
| skill | 2 | 10 | 100% | 100% | 50% | 18 | 236623 | 13353 | 1470 | 251463 | 20.8 |
| mcp | 2 | 10 | 100% | 100% | 100% | 17 | 126295 | 9069 | 1157 | 136538 | 19.0 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 14.4 | 14.5 | 179932 | 93546 | 1.92× | 100% | 100% | Yes |
| 2 | 20.8 | 19.0 | 251463 | 136538 | 1.84× | 100% | 100% | Yes |