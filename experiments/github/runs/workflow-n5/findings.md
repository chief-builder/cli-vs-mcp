# Experiment Report: github / workflow-n5 — All Tiers
_Generated: 2026-10-02T19:17:15.479Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

_Timed-out trials have no final usage totals. Their tokens are summed from per-message usage, which undercounts output and side-model calls, so averages that include them are lower bounds. Their time is the timeout that killed them._

| Task | Tier | Arm | Trials | Timeouts | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|----------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_workflow_status | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 661 | 67722 | 7783 | 714 | 76880 | 3.2 | 8.8 | 16.1s |
| tier1_workflow_status | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 662 | 54031 | 12585 | 603 | 67881 | 3.0 | 8.0 | 15.4s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| skill | 1 | 5 | 100% | 100% | 100% | 661 | 67722 | 7783 | 714 | 76880 | 8.8 |
| mcp | 1 | 5 | 100% | 100% | 100% | 662 | 54031 | 12585 | 603 | 67881 | 8.0 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 8.8 | 8.0 | 76880 | 67881 | 1.13× | 100% | 100% | Yes |

## Narrative

**Run config.** N=5, skill + mcp arms, github experiment (read-only). Single-primitive read: list the workflow runs on the repo and report `{workflow_name, conclusion, head_sha}` for the most recent.

**Headline.**

| Arm | Pass | Valid | Avg total tok | Avg turns | Avg wall |
|---|---:|---:|---:|---:|---:|
| skill | 5/5 | 5/5 | 76,880 | 8.8 | 16.1 s |
| mcp   | 5/5 | 5/5 | 67,881 | 8.0 | 15.4 s |

Skill/MCP token ratio: **1.13×** — the tightest clean comparison in the project so far. Tool call counts are identical (~3 each); the response payload is small (one workflow-run record per arm), so the per-turn-payload gap that drives larger cost ratios on chattier tasks barely fires here.

**The journey: a server-toolset gotcha.**

> **Correction (2026-10-02).** The `issue_triage` comparison drawn below was withdrawn: that task failed on token permissions, not missing primitives. The pre-fix smoke numbers are now marked as unrecorded.

The first smoke run (its result files were not kept, so these figures are from notes taken at the time) produced a striking result: skill 1.00 / 15 s / 8 turns; mcp 1.00 / **~170 s / ~60 turns**. Both passed, but MCP took ~10× longer and made 11 `ToolSearch` probes plus 8 `ReadMcpResourceTool` / `ListMcpResourcesTool` calls before reconstructing the answer by reading the `.yml` file directly and looking up commit metadata.

Root cause: the `actions` toolset was not in `GITHUB_TOOLSETS`. Our config was `context,repos,issues,pull_requests,users`. With the `actions` toolset missing, the server simply didn't expose `actions_list` / `actions_get` — and the MCP arm probed for tools it expected to exist. Adding `actions` to the toolset config dropped MCP wall to 15 s and turns to 8 — same shape as skill.

**Also corrected: tool-name drift.** Our hand-curated `GITHUB_READ_TOOLS` allow-list had guessed at `list_workflow_runs` / `get_workflow_run`, but the actual github-mcp-server names are the collapsed `actions_list` / `actions_get` (matching its `issue_read` / `issue_write` convention). Replaced with the correct names. Under `bypassPermissions` the allow-list was documentation rather than enforcement. Since 2026-10-02 the harness no longer enumerates MCP tool names: the MCP surface is whatever the configured server exposes, and built-in tools are restricted with `--tools`.

**Pattern confirmation.** With this fourth clean GH comparison, the ratios read:

| Task | Skill turns | Skill tok | MCP turns | MCP tok | Skill/MCP |
|---|---:|---:|---:|---:|---:|
| `tier1_pr_diff_answer` | 8.0 | 73,146 | 8.2 | 55,534 | 1.32× |
| `tier1_workflow_status` | 8.8 | 76,880 | 8.0 | 67,881 | **1.13×** |
| `tier2_issue_workflow`  | 10.6 | 106,912 | 12.4 | 77,645 | 1.38× |
| `tier2_issue_create`    | 5.2 | 53,760 | 5.8 | 41,169 | 1.31× |

Range 1.13×–1.38×, all favoring MCP. Direction is now supported across **9 of 11 clean cross-domain comparisons** (Playwright 5/6 + GitHub 4/4) inside the 1.13×–1.42× band. The Playwright tier1_form outlier (2.51×) remains the only data point above 1.5×.

**What changed about MCP's failure-mode story.** The initial `tier1_workflow_status` smoke (10× slower) suggests **MCP struggles when the primitive it needs isn't surfaced**: it reconstructed the answer through more expensive paths until the toolset fix. (`tier1_issue_triage` was originally cited here too, but its 0/5 turned out to be a token-permission failure; see `../n5/findings.md`.) Once the right primitive is exposed, the same task drops back to skill-comparable turn counts.

This is partly a server-implementation property (the github-mcp-server's tool catalog is composed of specific named primitives, not a free-form gateway) and partly an agent behavior (the agent doesn't fail gracefully when its expected tool name isn't there — it probes extensively). Both are interesting; together they argue for treating MCP server toolset configuration as load-bearing for the comparison, not as setup boilerplate.
