# Experiment Report: playwright / n5 — All Tiers
_Generated: 2026-10-02T19:17:14.728Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

_Timed-out trials have no final usage totals. Their tokens are summed from per-message usage, which undercounts output and side-model calls, so averages that include them are lower bounds. Their time is the timeout that killed them._

| Task | Tier | Arm | Trials | Timeouts | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|----------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_form | 1 | baseline | 5 | 5 | 0% | 100% | 100% | 0.0 | 6 | 27373 | 5207 | 61 | 32646 | 2.6 | 5.0 | 240.0s |
| tier1_form | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 728 | 277078 | 11776 | 1473 | 291055 | 12.6 | 19.4 | 46.3s |
| tier1_form | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 724 | 106264 | 7969 | 998 | 115955 | 7.0 | 13.8 | 23.3s |
| tier1_login | 1 | baseline | 5 | 2 | 0% | 80% | 80% | 0.0 | 458 | 595663 | 34404 | 4755 | 635280 | 25.0 | 52.4 | 201.7s |
| tier1_login | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 609 | 175152 | 13118 | 1115 | 189994 | 8.2 | 14.6 | 38.2s |
| tier1_login | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 610 | 123939 | 8332 | 1326 | 134207 | 8.2 | 17.4 | 30.2s |
| tier1_products | 1 | baseline | 5 | 5 | 0% | 100% | 100% | 0.0 | 2 | 12736 | 2067 | 27 | 14832 | 1.2 | 2.2 | 240.0s |
| tier1_products | 1 | skill | 5 | 0 | 100% | 100% | 20% | 1.0 | 702 | 272247 | 11798 | 1859 | 286605 | 12.4 | 18.4 | 56.7s |
| tier1_products | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 706 | 192793 | 8197 | 1513 | 203209 | 13.2 | 21.2 | 35.6s |
| tier1_scrape | 1 | baseline | 5 | 5 | 0% | 100% | 100% | 0.0 | 14 | 132385 | 8183 | 151 | 140734 | 8.2 | 14.4 | 240.0s |
| tier1_scrape | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 668 | 92812 | 10101 | 814 | 104395 | 4.2 | 8.6 | 27.7s |
| tier1_scrape | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 670 | 70152 | 6894 | 896 | 78613 | 4.8 | 11.0 | 18.1s |
| tier2_checkout | 2 | baseline | 5 | 5 | 0% | 100% | 100% | 0.0 | 5 | 23208 | 4430 | 52 | 27696 | 2.4 | 4.8 | 240.0s |
| tier2_checkout | 2 | skill | 5 | 0 | 100% | 100% | 0% | 1.0 | 727 | 289512 | 12496 | 1461 | 304195 | 13.0 | 20.4 | 44.1s |
| tier2_checkout | 2 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 734 | 224650 | 9573 | 1590 | 236548 | 14.6 | 27.0 | 52.6s |
| tier2_recovery | 2 | baseline | 5 | 5 | 0% | 100% | 100% | 0.0 | 51 | 677596 | 43240 | 501 | 721388 | 23.4 | 43.6 | 240.0s |
| tier2_recovery | 2 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 707 | 285480 | 12043 | 1829 | 300059 | 13.0 | 22.4 | 53.1s |
| tier2_recovery | 2 | mcp | 5 | 3 | 40% | 100% | 100% | 0.4 | 287 | 80947 | 6926 | 510 | 88669 | 5.8 | 11.8 | 158.1s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 4 | 19 | 0% | 100% | 100% | 108 | 198149 | 12803 | 1165 | 212226 | 18.9 |
| skill | 4 | 20 | 100% | 100% | 80% | 677 | 204322 | 11698 | 1315 | 218012 | 15.3 |
| mcp | 4 | 20 | 100% | 100% | 100% | 678 | 123287 | 7848 | 1183 | 132996 | 15.8 |

### Tier 2

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 2 | 10 | 0% | 100% | 100% | 28 | 350402 | 23835 | 277 | 374542 | 24.2 |
| skill | 2 | 10 | 100% | 100% | 50% | 717 | 287496 | 12269 | 1645 | 302127 | 21.4 |
| mcp | 2 | 10 | 70% | 100% | 100% | 511 | 152799 | 8250 | 1050 | 162609 | 19.4 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 15.3 | 15.8 | 218012 | 132996 | 1.64× | 100% | 100% | Yes |
| 2 | 21.4 | 19.4 | 302127 | 162609 | 1.86× | 100% | 70% | No |

## Narrative

> **Correction (2026-10-02).** Tables above were regenerated after fixing timeout accounting: timed-out trials used to record 0 tokens. The Tier 2 Skill/MCP token ratio is **1.86×** as reported (the MCP figure includes 3 timed-out `tier2_recovery` trials whose tokens are lower-bound estimates), **1.52×** on completed trials only; it was previously reported as 2.01×. The cost-mechanism and `tier2_recovery` failure descriptions below were corrected against the transcripts. During this run `--allowed-tools` did not restrict tools (every arm also had Read/Glob/Grep/Edit); arms now get a positive `--tools` list.

**Run config.** N=5 per task per arm. Per-trial wall clock capped at 240 s (raised from 180 s after smoke flagged tier-2 skill timeouts). Six tasks total: four tier-1 read-only, two tier-2 multi-step. Validity mode: `practical` (chained `playwright-cli` calls inside one Bash invocation count as valid).

**Headline.**

| Tier | Arm | Success | Avg total tokens (valid) | Avg turns |
|---|---|---|---:|---:|
| 1 | baseline | 0/20 | n/a (no exec surface) | 18.5 |
| 1 | skill    | **20/20** | 218,012 | 15.3 |
| 1 | mcp      | **20/20** | 132,996 | 15.8 |
| 2 | baseline | 0/10 | n/a | 24.2 |
| 2 | skill    | **10/10** | 302,127 | 21.4 |
| 2 | mcp      | 7/10 | 162,609 | 19.4 |

**Tier 1 — both browser arms match on success; MCP is 1.64× cheaper.** Every tier-1 trial passed for both skill and mcp. Total-token ratio Skill/MCP = 1.64× (smoke had 1.82×; ratio compressed slightly as N grew). Tier-level turn counts are close (15.3 vs 15.8), but individual tasks differ (form 19.4 vs 13.8). Where the gap is largest, it comes from call shape: on `tier1_form` the skill arm made 25 per-field `fill` calls across 5 trials (and only 8 `snapshot` calls), while MCP filled each form with one batched `browser_fill_form`. Wall clock follows the same shape: skill averages ~42 s/task vs mcp ~27 s/task. Across 4 tasks and 5 trials each, no skill or mcp trial timed out or was flagged off-surface.

**Tier 2 — the 240 s budget bump rescued skill; MCP develops its first weakness.** The smoke 180 s timeout had killed both skill trials. At 240 s, skill is **10/10** with avg wall 53 s — well inside the new budget. MCP, however, dropped 3/5 on `tier2_recovery`: the passing trials finished in 34–37 s, while the three failures stalled after at most 4 tool calls (one after a single `ToolSearch`) and produced no further events until the 240 s kill. The transcripts don't show a cause (one ends on an API-retry event); there is no looping. `tier2_checkout` was unanimous for both arms at 100%.

**Validity surface stayed clean.** No skill or mcp Playwright trial was flagged off-surface — no `WebFetch`, `WebSearch`, mcp/skill cross-leak, or `Bash`-escape attempts. (At the time `--allowed-tools` did not actually restrict tools; see the correction note.) The "Single CLI Cmd" column drops for skill (80% tier 1, 50% tier 2) because the agent chains multiple `playwright-cli` calls in one Bash invocation — valid under `practical` mode and noted but not penalized.

**What changed vs smoke.** (1) Tier-2 skill went from 1/2 to 10/10 thanks to the timeout bump. (2) Tier-1 token ratio fell from 1.82× to 1.64× at higher N. (3) A new MCP failure mode emerged: `tier2_recovery` is genuinely flaky for MCP at 240 s, dropping from a smoke 1/1 to 2/5.

**Caveats.** Five trials per task is small for sub-30% effect sizes; the 1.64× cost ratio is stable but the 40% (2/5) MCP success on `tier2_recovery` could swing widely at N=5. The Tier-2 skill row's 100% should not be over-read as "skill scales fine to multi-step"; 3 of 10 skill Tier-2 trials took 50–70 s against the 240 s budget.
