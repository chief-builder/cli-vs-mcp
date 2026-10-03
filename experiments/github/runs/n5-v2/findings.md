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

## Narrative

**Run config.** 2026-10-03. Claude Code 2.1.288, `claude-sonnet-4-6`, `github-mcp-server` v1.0.4 (pinned by digest). N=5 per task for skill and mcp, N=2 for baseline; the directed variant is skill-only, N=5. Tier 1 used a read-only agent token (Contents, Issues, Pull requests, Actions: read); Tier 2 (`github-rw`) a read-write one with no admin rights. All tokens, controller included, belong to the same GitHub user. The skill arm's Bash ran in Claude Code's OS sandbox, which blocks the developer's keychain `gh` login and `$HOME`, and `gh` got an empty per-trial config dir. Lane logs with versions: `gh-t1.log`, `gh-t1-workflow-status.log`, `gh-t2.log`.

**Headline.** MCP passed and stayed in surface on all 7 tasks (35/35). Skill passed every trial except one `tier2_issue_create` checker false negative (below) and the directed variant. Baseline 0/14.

| Task | Skill pass / valid | MCP pass / valid | Skill tok | MCP tok | Skill/MCP |
|---|---|---|---:|---:|---:|
| tier1_repo_inventory | 5 / **0** | 5 / 5 | (85,734, all invalid) | 44,136 | no clean skill trials |
| tier1_issue_triage | 5 / 5 | 5 / 5 | 67,033 | 40,230 | 1.67× |
| tier1_pr_diff_answer | 5 / 5 | 5 / 5 | 66,564 | 38,840 | 1.71× |
| tier1_workflow_status | 5 / 5 | 5 / 5 | 77,230 | 50,659 | 1.52× |
| tier2_issue_workflow | 5 / 5 | 5 / 5 | 100,251 | 56,534 | 1.77× |
| tier2_file_patch_pr | 5 / **0** | 5 / 5 | (153,022, all invalid) | 58,394 | no clean skill trials |
| tier2_issue_create | 4 / 5 | 5 / 5 | 48,385 | 28,623 | 1.69× |

**`issue_triage` is a real comparison now.** With an agent token that can read issues, both arms solved it 5/5 in surface (8.6 vs 8.0 turns). The `n5` result (MCP 0/5, skill passing only with escalated credentials) was entirely the token.

**The validity finding held.** Skill escaped on every trial of the same two tasks as in `n5`: `repo_inventory` (`gh api … | base64 -d` to decode README content) and `file_patch_pr` (`base64 -d` on the read side plus shell variables and `$(…)` to build the PUT body). These are the tasks where `gh` has no first-class command for the primitive.

**Directed prompt.** Naming the in-surface workaround did not help: pass 2/5, valid 3/5, and **0/5 both**. Trial #1 used `$(…)` in `gh pr create`, and #2 used `base64 -d`. The three valid trials (#3–#5) timed out after 10–13 turns, with transcripts that end in extended thinking and no further tool calls. Passing trials averaged 401,861 tokens, 2.63× the undirected run (153,022).

**Cost.** On the five clean tasks skill cost 1.52–1.77× MCP, up from 1.13–1.38× in `n5`. As on the Playwright side, MCP got cheaper by more (e.g. `pr_diff_answer` MCP 55,534 → 38,840, skill 73,146 → 66,564). Fixed first-turn context fell for both arms (mcp ~12.8k → ~8.8k, skill ~16.6k → ~15.1k). The tool restriction and the Claude Code upgrade changed together, so the multiple is setup-specific; the direction held.

**Run incidents.**
- The first attempt at `tier1_workflow_status` failed in setup: the controller token lacked Actions: read, and the setup failure leaked repos. Fixed in `8a6cc40` (setup failures now delete their repo). The task was re-run after the token gained Actions: read (`gh-t1-workflow-status.log`).
- The `tier2_issue_create` skill trial #5 is recorded as a fail. The agent created the issue with the exact expected title, body and labels, but the success check's 3-second list window missed it. The window was widened in `40521c2`. The trial can't be re-scored because its repo is deleted.
- Two `workflow_status` skill calls were recorded by Claude Code as unparsed input and briefly misclassified. The parser was fixed in `40521c2` and the metrics recomputed.

**Caveats.** N=5 (baseline N=2). Same GitHub identity for all tokens. Only the skill arm's Bash is OS-sandboxed; file tools can still read outside `~` and the repo (redacted from artifacts).
