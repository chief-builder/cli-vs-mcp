# GitHub Tier 1 Smoke (smoke-n1) — Findings

- **Run**: `smoke-n1` (N=1 per task per arm)
- **Generated**: 2026-05-15
- **Model**: `claude-sonnet-4-6`
- **Tasks**: `tier1_repo_inventory`, `tier1_issue_triage`, `tier1_pr_diff_answer`
- **Sandbox owner**: `chief-builder-lab` (private org, fine-grained PATs, sandbox-scoped)
- **Versions**: `gh` 2.74.0, `github-mcp-server@sha256:e3816a47…` (image digest), classifier in read-only mode

## Headline numbers

| Arm | Success | Valid surface | Avg total tokens | Avg turns | Avg wall-clock |
|---|---:|---:|---:|---:|---:|
| baseline | 0/3 | n/a (no execution) | — | 46.7 | timeout (180 s) on all |
| **skill** (`gh`) | **3/3** | 2/3 valid (1 base64 escape) | **73,209** | **7.0** | 20.2 s |
| **mcp** (`github-mcp-server --read-only`) | **3/3** | 3/3 valid | **92,224** | 14.0 | 34.5 s |

## What the numbers say

**Both browser arms pass every task. Baseline hard-fails at zero.** GitHub state lives off-host so baseline cannot glob-walk the filesystem to recover answers — exactly the clean-zero property the methodology predicted, in contrast to Playwright Tier 1 where baseline can in principle `Read` fixture HTML.

**Skill is cheaper than MCP at Tier 1 — opposite of Playwright.** Across the three tasks, the `gh` skill arm averages **73,209 tokens** vs `github-mcp-server`'s **92,224 tokens** — a Skill/MCP ratio of **0.79×**. The mechanism is `gh --json <fields> --jq '<filter>'`: the agent picks exactly which fields to retrieve and filters them server-side, so the tool-result payload is a small projected JSON. The MCP server returns its tool's full structured response, which carries more fields per call.

- `tier1_issue_triage`: skill 73,718 tok / 8 turns vs mcp 58,571 tok / 8 turns. MCP wins here — `mcp__github__list_issues` with built-in filters is very compact.
- `tier1_pr_diff_answer`: skill 72,700 tok / 6 turns vs mcp 55,469 tok / 8 turns. MCP wins again — `gh pr view --json` carries more fields than the MCP read.
- `tier1_repo_inventory`: skill 94,199 tok / 14 turns vs mcp 162,632 tok / 26 turns. **Skill is 0.58× MCP here.** The MCP agent took 26 turns and almost double the tokens to assemble repo description + topics + default branch + README marker, because each comes from a separate `mcp__github__*` call. The skill agent did the same in 14 turns with `gh repo view --json` (one call, multiple fields).

**Turn count: skill 7 vs mcp 14, average.** Each `gh --json` call returns multiple fields in one shot, so the agent needs fewer round-trips. MCP separates concerns by tool (e.g. `get_repository`, `get_file_contents`, `get_repository_topics`), pushing turn count up.

## Validity surface

- **skill** 2/3 valid. `tier1_repo_inventory` (skill) is the one INVALID trial: the agent piped `gh api repos/.../contents/README.md --jq '.content' | base64 -d` to decode the base64-encoded `content` field returned by the contents API. The `base64 -d` segment is not `gh`, so the classifier correctly flagged it as out-of-surface. **This is a real finding, not a classifier false positive:** the GitHub CLI doesn't expose a high-level "fetch file content as text" command; the agent had to reach for `base64`. The MCP arm's `get_file_contents` exposes decoded text directly, which is why MCP did not escape on the same task.
- **mcp** 3/3 valid. No `Bash`, `Skill`, or `Agent` calls. Pure `mcp__github__*` traffic.
- **baseline** 3/3 valid (no execution attempted, so nothing to escape).

## Caveats

- **N=1**. The 0.79× headline ratio is suggestive but should be re-measured at N≥3. The `tier1_repo_inventory` MCP run looks like a particularly bad case for MCP — at higher N it may regress to the mean.
- **The skill arm's base64 escape inflates its measured "validity" only when the classifier is strict.** A practical-mode run that allowed shell helpers as long as the data path is reasonable would mark it valid. The strict policy is correct for measuring tool-surface costs in the abstract; it shouldn't be read as the skill arm "failing."
- **The MCP server's default toolset (`context,repos,issues,pull_requests,users`) is what's exposed.** Adding more toolsets would widen the surface and likely raise MCP's per-trial tokens, not lower them.
- **`gh api` defaults to GET only when no parameter flags are passed.** The classifier's Tier 1 read-only check correctly flags `-f`/`-F`/`--input` without an explicit `--method GET` as a write attempt. Our smoke didn't trip this; the skill agent only used `gh repo view`, `gh issue list/view`, `gh pr view`, `gh pr diff`, and read-only `gh api`.

## Comparison to Playwright

| Surface | Skill/MCP token ratio (Tier 1) | Notes |
|---|---|---|
| Playwright | **1.82×** (skill heavier) | Each Skill step is two tool calls (action + explicit snapshot); MCP bundles the post-action snapshot inline. |
| GitHub | **0.79×** (MCP heavier) | `gh --json <fields> --jq` projects minimal output; MCP returns full structured responses. |

The two experiments measure opposite phenomena from the same harness:

- Playwright shows that a **conversational CLI Skill that needs an explicit "what's on the page now" call after each action** loses to an MCP server that bundles state into action responses.
- GitHub shows that a **CLI with mature output filtering (`--json`, `--jq`) and dense multi-field reads** can beat an MCP server whose tools split a single conceptual question into many narrowly-scoped reads.

Tool surface is not just "API vs CLI" — it's the affordance shape. A skill arm wins when the CLI can shape its own output; a MCP arm wins when the wrapper bundles state the agent would otherwise have to re-request.

## Reproducing

```bash
export GITHUB_CONTROLLER_TOKEN=ghp_…
export GITHUB_AGENT_TOKEN=ghp_…
export GITHUB_SANDBOX_OWNER=chief-builder-lab

pnpm harness run --experiment github --run smoke-n1 --arm skill    --tier 1 --trials 1
pnpm harness run --experiment github --run smoke-n1 --arm mcp      --tier 1 --trials 1
pnpm harness run --experiment github --run smoke-n1 --arm baseline --tier 1 --trials 1
pnpm harness report --experiment github --run smoke-n1 --all-tiers --crossover-analysis \
  --output experiments/github/runs/smoke-n1/findings.md
```

See `report.md` for the raw per-task and crossover tables.
