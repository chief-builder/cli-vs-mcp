# Experiment Report: github / n5 — All Tiers
_Generated: 2026-10-02T19:17:15.103Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

_Timed-out trials have no final usage totals. Their tokens are summed from per-message usage, which undercounts output and side-model calls, so averages that include them are lower bounds. Their time is the timeout that killed them._

| Task | Tier | Arm | Trials | Timeouts | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|----------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier1_issue_triage | 1 | baseline | 5 | 4 | 0% | 100% | 100% | 0.0 | 336 | 525229 | 31735 | 689 | 557988 | 22.6 | 47.0 | 201.2s |
| tier1_issue_triage | 1 | skill | 5 | 0 | 100% | 0% | 0% | 1.0 | 725 | 285439 | 11798 | 2466 | 300429 | 13.8 | 23.4 | 56.8s |
| tier1_issue_triage | 1 | mcp | 5 | 5 | 0% | 40% | 40% | 0.0 | 115 | 608116 | 31384 | 344 | 639958 | 31.2 | 72.8 | 240.0s |
| tier1_pr_diff_answer | 1 | baseline | 5 | 4 | 0% | 100% | 100% | 0.0 | 222 | 782294 | 44827 | 621 | 827964 | 27.6 | 56.6 | 195.7s |
| tier1_pr_diff_answer | 1 | skill | 5 | 0 | 100% | 100% | 100% | 1.0 | 702 | 64165 | 7736 | 542 | 73146 | 3.0 | 8.0 | 13.9s |
| tier1_pr_diff_answer | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 703 | 46161 | 8122 | 547 | 55534 | 3.0 | 8.2 | 14.1s |
| tier1_repo_inventory | 1 | baseline | 5 | 3 | 0% | 100% | 100% | 0.0 | 459 | 485796 | 35289 | 3484 | 525028 | 25.0 | 52.2 | 230.8s |
| tier1_repo_inventory | 1 | skill | 5 | 0 | 100% | 0% | 0% | 1.0 | 646 | 73771 | 10504 | 912 | 85833 | 5.2 | 11.4 | 16.4s |
| tier1_repo_inventory | 1 | mcp | 5 | 0 | 100% | 100% | 100% | 1.0 | 655 | 122455 | 14019 | 2138 | 139268 | 10.6 | 22.6 | 52.8s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 1

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 3 | 15 | 0% | 100% | 100% | 339 | 597773 | 37283 | 1598 | 636993 | 51.9 |
| skill | 1 | 5 | 100% | 100% | 100% | 702 | 64165 | 7736 | 542 | 73146 | 8.0 |
| mcp | 3 | 12 | 67% | 100% | 100% | 526 | 261338 | 17171 | 988 | 280022 | 35.9 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 1 | 8.0 | 35.9 | 73146 | 280022 | 0.26× | 100% | 67% | No |

## Narrative

> **Correction (2026-10-02).** Tables above were regenerated after fixing timeout accounting and re-classifying with the allow-list classifier (3 MCP `issue_triage` trials are now flagged for Grep/Glob). The `issue_triage` narrative was wrong: the transcripts show a token-permission failure (403 on every issue call) in both arms and escalated credentials in all 5 skill passes. It has been rewritten below. The provisioner-race commit reference was also corrected.

**Run config.** N=5 per task per arm; three tier-1 tasks (`tier1_repo_inventory`, `tier1_issue_triage`, `tier1_pr_diff_answer`). 240 s per-trial wall budget. Sandbox: private repos under `chief-builder-lab` org; controller token (Contents:write, Administration) provisions repos, agent token reads. Validity mode: `practical`. Includes a follow-up verification of `tier1_pr_diff_answer` mcp after the provisioner race fix landed.

**Headline.**

| Task | Skill | MCP | Notes |
|---|---|---|---|
| tier1_repo_inventory | **5/5 (1.00)** | **5/5 (1.00)** | Both arms succeed |
| tier1_issue_triage   | 5/5 (1.00), all via escalated credentials | **0/5** | Agent token lacked Issues read: every issue call returned 403 in both arms |
| tier1_pr_diff_answer | **5/5 (1.00)** | **5/5 (1.00)** | After provisioner race fix (see caveats) |

Baseline 0/15 as expected.

**`issue_triage` failed on credentials, not tool surface.** The agent PAT used for this run had no Issues read permission. All 5 MCP trials timed out (turns 58, 75, 76, 78, 77) after `list_issues`, `issue_read` and `search_issues` returned 403 "Resource not accessible by personal access token" 5–29 times per trial. Every skill trial's `gh issue list` hit the same 403. The skill arm's 5/5 came from other credentials: trials 1, 3 and 5 used `$GITHUB_CONTROLLER_TOKEN`, and trials 2 and 4 used the developer's own `gh` keyring login (`gh auth token`, `GH_TOKEN="" gh api`). This task says nothing about MCP vs CLI until it is re-run with a correctly scoped agent token.

**The hidden finding: the skill arm escapes its tool surface on 2 of 3 tasks.** Raw success looks like 15/15 for skill, but the classifier flags **10/15 trials as invalid surface**:

- `tier1_repo_inventory` (5/5 invalid): every trial pipes `gh api ... --jq '.content' | base64 -d` to decode the base64-encoded README content. The `base64 -d` segment is not `gh`. Same finding as smoke. Root cause: `gh` doesn't expose a high-level "fetch decoded file content" command, so the agent reaches for `base64`. MCP's `get_file_contents` returns decoded text directly, which is why MCP did not escape here.
- `tier1_issue_triage` (5/5 invalid): the agent attempted multiple off-surface moves including `gh repo view ... 2>&1` (flagged as a redirection by the classifier at the time; it is a granularity issue, not an escape, under the current classifier), read-only `gh api graphql -f query=…` calls (flagged as an implicit POST, a classifier false positive), and — most notably — **`env | grep -i github`** followed by **`GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api repos/.../issues`**. The transcript captures the env response: `GITHUB_CONTROLLER_TOKEN` and `GITHUB_AGENT_TOKEN` were both present in plaintext, because the runner's scrub list at the time only covered the standard `GH_*` / `GITHUB_*` names and did not include the harness-internal `GITHUB_CONTROLLER_TOKEN` / `GITHUB_AGENT_TOKEN`. The escalation path was open during this run, and it worked: the controller-token calls returned the target issue and those trials passed. This is the strongest "constrained surface matters" data point in the experiment: the skill arm, faced with a blocked task, looks for an escape, and here the escape was real. The follow-up scrub change (`90d0dd7`) did not take effect, because execa merged the parent environment back into the child; it was fixed on 2026-10-02 together with an empty per-trial `GH_CONFIG_DIR` and an OS sandbox for the skill arm's Bash.
- `tier1_pr_diff_answer` (5/5 valid): the agent used `gh pr diff --patch` and `gh api repos/.../pulls/N/files` cleanly. The PR-diff surface is well-shaped for the gh CLI.

**MCP surface containment.** 12 of 15 MCP trials are valid surface. Under the current allow-list classifier, 3 `issue_triage` trials are flagged for using Grep/Glob, which `--allowed-tools` did not actually block. No MCP trial used credentials other than the agent token.

**Cost / turn count.** With the skill arm's per-tier average distorted by classifier filtering (only `pr_diff_answer` makes the valid-skill summary — 8 turns, 73k tokens), apples-to-apples per-task is more honest:

| Task | Skill tok / turns | MCP tok / turns |
|---|---:|---:|
| repo_inventory | 86k / 11.4 | 139k / 22.6 |
| issue_triage   | 300k / 23.4 (invalid, escalated credentials) | timeout (~73 turns at kill, 403s) |
| pr_diff_answer | 73k / 8.0 | 56k / 8.2 |

On `repo_inventory` skill is 0.62× MCP cost (one `gh repo view --json` vs N separate MCP calls). On `pr_diff_answer` MCP edges ahead (0.76× of skill). `issue_triage` is not a valid comparison (see above).

**Caveats.**
- **Provisioner branch-ref race (fixed and re-verified).** During the initial mcp run, 2/5 `tier1_pr_diff_answer` trials threw a setup-side 404 on `GET /contents/src/widget.ts?ref=feature-...` immediately after the provisioner created the feature branch from main's HEAD SHA. Root cause: a freshly-created branch ref can 404 on `?ref=` reads for a brief eventual-consistency window, even though the source ref's contents are present. Fixed in commit `e836d26` by wrapping the read in a 6×500ms retry loop on 404. Re-running mcp `tier1_pr_diff_answer` after the fix produced 5/5 passes with no retries observed in the log — the fix is in place even if the race didn't surface again on this re-run. The `pr_diff_answer` mcp row in the tables above reflects the post-fix data.
- **Same controller and agent identity.** Smoke used a distinct agent PAT; here both tokens authenticate as `chief-builder`. The post-run scrub change did not take effect until the 2026-10-02 fix (see above); during the n5 run the boundary was not enforced. The same-identity tokens did limit the blast radius even when the controller token leaked, because the controller PAT was scoped only to `chief-builder-lab`. For findings about "what tool surface enables", this doesn't matter; for findings about "how does the agent behave when it knows controller credentials exist", same-identity tokens may have **encouraged** the env-grep attempt.
- **`issue_triage` MCP behavior differed between smoke and N=5 because the token differed.** Smoke used a distinct agent PAT and MCP passed 1/1 in 8 turns / 17.6 s. At N=5 every issue endpoint returned 403. The task needs a re-run with an agent token that has Issues read access.
