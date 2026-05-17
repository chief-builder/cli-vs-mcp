# Experiment Report: github / tier2-n5 — Tier 2
_Generated: 2026-05-17T16:10:55.666Z_
_Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI._

## Per-Task Results

_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._

| Task | Tier | Arm | Trials | Success | Valid Surface | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |
|------|------|-----|--------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|
| tier2_file_patch_pr | 2 | baseline | 5 | 0% | 100% | 100% | 0.0 | 134 | 56533 | 3977 | 1129 | 61773 | 28.8 | 55.4 | 28.0s |
| tier2_file_patch_pr | 2 | skill | 5 | 100% | 0% | 0% | 1.0 | 648 | 132818 | 8972 | 1436 | 143875 | 7.2 | 13.2 | 35.4s |
| tier2_file_patch_pr | 2 | mcp | 5 | 100% | 100% | 100% | 1.0 | 678 | 79765 | 8565 | 1428 | 90436 | 5.8 | 12.8 | 28.8s |
| tier2_issue_workflow | 2 | baseline | 5 | 0% | 80% | 80% | 0.0 | 0 | 0 | 0 | 0 | 0 | 31.8 | 67.6 | 0.0s |
| tier2_issue_workflow | 2 | skill | 5 | 100% | 100% | 100% | 1.0 | 606 | 97528 | 7938 | 841 | 106912 | 5.0 | 10.6 | 21.1s |
| tier2_issue_workflow | 2 | mcp | 5 | 100% | 100% | 100% | 1.0 | 606 | 67829 | 8166 | 1044 | 77645 | 5.2 | 12.4 | 23.4s |

## Per-Tier Summary

_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._

### Tier 2

| Arm | Tasks | Trials (valid) | Avg Success | Avg Valid Surface | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |
|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|
| baseline | 2 | 9 | 0% | 100% | 100% | 67 | 28267 | 1989 | 565 | 30887 | 59.6 |
| skill | 1 | 5 | 100% | 100% | 100% | 606 | 97528 | 7938 | 841 | 106912 | 10.6 |
| mcp | 2 | 10 | 100% | 100% | 100% | 642 | 73797 | 8365 | 1236 | 84041 | 12.6 |


## Crossover Analysis

Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.

| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |
|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|
| 2 | 10.6 | 12.6 | 106912 | 84041 | 1.27× | 100% | 100% | Yes |
## Narrative

**Run config.** N=5 per task per arm. Two Tier 2 mutation tasks (`tier2_issue_workflow`, `tier2_file_patch_pr`). 240 s per-trial wall budget. Same sandbox model as Tier 1 — controller token provisions and verifies, agent token (now write-scoped) executes. The `github-rw` experiment selects `.mcp.github.rw.json` (write tools enabled) and the classifier's non-readOnly mode (mutators are not flagged as escapes).

**Headline.**

| Task | baseline | skill (raw) | skill (valid) | mcp |
|---|---|---|---|---|
| `tier2_issue_workflow` | 0/5 | 5/5 | **5/5** | **5/5** |
| `tier2_file_patch_pr`  | 0/5 | 5/5 | **0/5** (all INVALID) | **5/5** |

Baseline 0/10 (all timeouts; off-host state, no execution surface). All skill and mcp trials passed at 1.00.

**The headline finding: skill stays in surface only when `gh` has first-class commands for the workflow primitives.** Both arms reach the same end state on both tasks. The split is on *how*:

- `issue_workflow` decomposes cleanly into `gh issue edit --add-label`, `gh issue comment`, `gh issue close` — three first-class subcommands, each one Bash call, no shell text manipulation needed. All 5 skill trials stayed in surface.
- `file_patch_pr` requires three workflow primitives `gh` does not expose at the high level: create-branch-from-SHA, get-file-blob-SHA-on-branch, update-file-on-branch-with-base-SHA. The agent fell back to raw `gh api` calls for those — fine on its own — but constructing the new file content payload required a shell variable assignment `NEW_CONTENT='...'`, which the classifier rejects because it isn't a `gh` segment. **All 5 trials escaped surface in the same way.**

This is the cleanest "API affordance shape decides agent behavior" finding in the project to date. The skill arm doesn't escape because it's poorly prompted or because the agent is undisciplined — it escapes because `gh`'s command surface doesn't cover the primitives a multi-file mutation workflow needs, and the agent reaches for shell text plumbing to bridge the gap.

**MCP wins both tasks on cost.**

| Task | Skill total tok | MCP total tok | Skill/MCP |
|---|---:|---:|---:|
| `issue_workflow` | 106,912 | 77,645 | 1.38× |
| `file_patch_pr` | 143,875 (invalid) | 90,436 | 1.59× |

On `issue_workflow`, where skill stayed in surface, MCP is 1.38× cheaper at matched success — each `mcp__github__*` call carries less payload than the corresponding `gh` Bash invocation (consistent with the Tier 1 pattern: bundled tool results vs shell-roundtripped JSON). On `file_patch_pr`, MCP is 1.59× cheaper *and* the only valid surface — `mcp__github__create_branch`, `create_or_update_file`, and `create_pull_request` are named primitives that map one-to-one to the workflow steps.

**MCP tool sequences (representative):**

`issue_workflow`: `search_issues` → `issue_write` (labels) → `add_issue_comment` → `issue_write` (state=closed). 4 ops, ~12 turns avg.

`file_patch_pr`: `get_file_contents` → `create_branch` → `create_or_update_file` → `create_pull_request`. 4 ops, ~13 turns avg.

**Skill tool sequence on `file_patch_pr` (every trial, 5/5):**

`gh api .../contents/...` (read) → `gh api .../git/refs/heads/main` (HEAD SHA) → `gh api .../git/refs -X POST` (create branch) → **`NEW_CONTENT='...'`** ← INVALID → `gh api .../contents/... -X PUT` (write file) → `gh pr create --title "..."`.

The shell-assignment step is structurally required: `gh api -X PUT` takes the new file content as a JSON body parameter, and the content needs to be a multi-line TypeScript blob with the per-trial marker substituted in. There is no `gh` command that takes a content string from another `gh` command's output without going through the shell. The five trials all converged on the same workaround. None recovered to a valid-surface path.

**Validity vs success: the metric divergence shows up.**

`tier2_file_patch_pr` is the clearest example yet of why this experiment measures both. The skill arm's success column reads 5/5; the valid-surface column reads 0/5. A success-only benchmark would conclude "skill matches MCP on file-patch-PR workflows." The classifier disagrees: every trial got there by stepping outside the intended tool surface, and every trial converged on the same escape pattern — a deterministic, reproducible affordance gap, not random misbehavior.

**Tier 2 baseline produced one Bash(gh) escape** out of 10 trials (`tier2_issue_workflow` trial 2, classifier-flagged). The pattern matches Tier 1: when the agent runs out of legitimate channels, it probes for hidden tools and eventually tries `Bash(gh ...)` directly. The deny list caught it; the validity column recorded it.

**Caveats.**
- **N=5 is small.** The 5/5 invalid result on `file_patch_pr` skill is striking, but it should be read as "this escape pattern is reproducible across 5 random seeds," not "skill cannot ever stay in surface on multi-file mutations." A targeted prompt rewrite ("do not use shell variable assignments; construct the request body using only `gh` flags") might reduce the escape rate — but it would also be measuring prompt engineering rather than tool surface, which is why this run doesn't do it.
- **Same controller/agent identity** carries forward from Tier 1. The agent and controller both authenticate as `chief-builder`; the controller has elevated write scope. The env-scrub fix from n5 still applies — the controller token is no longer reachable from the child env.
- **`tier2_pr_review` deferred.** GitHub forbids `APPROVE` and `REQUEST_CHANGES` reviews from the PR author. With same-identity tokens, only `COMMENT` reviews work, which makes the task less interesting. Picking this up requires a distinct PR-author identity (second sandbox PAT or a controller-as-app pattern).
- **Reporting bug fixed mid-run.** `pnpm harness report --experiment github-rw` initially reported "No results found" because the report CLI passed the raw `--experiment` string to the loader instead of resolving it through `getExperiment().name` (the rw spec spreads from the ro spec, so both share storage under `experiments/github/...`). Fixed inline.
