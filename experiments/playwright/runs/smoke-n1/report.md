# Experiment Report: playwright / smoke-n1 — All Tiers
_Generated: 2026-05-15T11:41:09.575Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

| Task | Tier | Arm | Trials | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_form | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 15.0 | 34.0 | 0.0s |
| tier1_form | 1 | skill | 1 | 100% | 100% | 100% | 1.0 | 728 | 309768 | 12021 | 1623 | 324140 | 14.0 | 21.0 | 70.0s |
| tier1_form | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 724 | 106319 | 8000 | 970 | 116013 | 7.0 | 14.0 | 26.3s |
| tier1_login | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 23.0 | 44.0 | 0.0s |
| tier1_login | 1 | skill | 1 | 100% | 100% | 100% | 1.0 | 608 | 173301 | 11013 | 1243 | 186165 | 8.0 | 16.0 | 29.6s |
| tier1_login | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 610 | 136193 | 8414 | 1240 | 146457 | 9.0 | 16.0 | 29.0s |
| tier1_products | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 7.0 | 16.0 | 0.0s |
| tier1_products | 1 | skill | 1 | 100% | 100% | 0% | 1.0 | 703 | 306755 | 11863 | 1822 | 321143 | 14.0 | 19.0 | 54.9s |
| tier1_products | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 703 | 172322 | 7768 | 1063 | 181856 | 12.0 | 19.0 | 25.8s |
| tier1_scrape | 1 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 29.0 | 58.0 | 0.0s |
| tier1_scrape | 1 | skill | 1 | 100% | 100% | 100% | 1.0 | 667 | 88669 | 10145 | 842 | 100323 | 4.0 | 10.0 | 57.3s |
| tier1_scrape | 1 | mcp | 1 | 100% | 100% | 100% | 1.0 | 669 | 59289 | 6688 | 714 | 67360 | 4.0 | 11.0 | 19.1s |
| tier2_checkout | 2 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 2.0 | 4.0 | 0.0s |
| tier2_checkout | 2 | skill | 1 | 0% | 100% | 0% | 0.0 | 0 | 0 | 0 | 0 | 0 | 12.0 | 18.0 | 0.0s |
| tier2_checkout | 2 | mcp | 1 | 100% | 100% | 100% | 1.0 | 734 | 228510 | 9566 | 1650 | 240460 | 15.0 | 26.0 | 47.8s |
| tier2_recovery | 2 | baseline | 1 | 0% | 100% | 100% | 0.0 | 0 | 0 | 0 | 0 | 0 | 34.0 | 67.0 | 0.0s |
| tier2_recovery | 2 | skill | 1 | 100% | 100% | 0% | 1.0 | 0 | 0 | 0 | 0 | 0 | 10.0 | 17.0 | 0.0s |
| tier2_recovery | 2 | mcp | 1 | 100% | 100% | 100% | 1.0 | 706 | 151614 | 8377 | 1200 | 161897 | 10.0 | 20.0 | 29.4s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 4 | 4 | 0% | 100% | 100% | 0 | 0 | 0 | 0 | 0 | 38.0 |
| skill | 4 | 4 | 100% | 100% | 75% | 677 | 219623 | 11261 | 1383 | 232943 | 16.5 |
| mcp | 4 | 4 | 100% | 100% | 100% | 677 | 118531 | 7718 | 997 | 127922 | 15.0 |

### Tier 2

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 2 | 2 | 0% | 100% | 100% | 0 | 0 | 0 | 0 | 0 | 35.5 |
| skill | 2 | 2 | 50% | 100% | 0% | 0 | 0 | 0 | 0 | 0 | 17.5 |
| mcp | 2 | 2 | 100% | 100% | 100% | 720 | 190062 | 8972 | 1425 | 201179 | 23.0 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 16.5 | 15.0 | 232943 | 127922 | 1.82× | 100% | 100% | Yes |
| 2 | 17.5 | 23.0 | 0 | 201179 | 0.00× | 50% | 100% | Yes |