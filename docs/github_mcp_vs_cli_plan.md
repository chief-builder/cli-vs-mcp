# GitHub MCP vs GitHub CLI Experiment Plan

Status: planning only. No implementation in this document.

Last reviewed: 2026-05-14
Revised: 2026-05-14 — incorporated review feedback on classifier pluggability, skill/MCP packaging, provisioning budget, and measurement-shape risks.

## Goal

Extend the existing CLI-vs-MCP harness to compare:

- `mcp`: GitHub MCP Server from `github/github-mcp-server`
- `skill`: GitHub CLI (`gh`) exposed through a Claude Code Skill
- `baseline`: same prompt, no GitHub execution surface

The experiment should answer the same class of question as the Playwright study: when the agent needs to inspect, mutate, and reason over GitHub state, does a structured MCP server or a CLI skill produce better outcomes, lower token cost, fewer turns, fewer escape attempts, and more stable behavior?

The primary measurements should remain:

- pass/fail and score
- total tokens and token composition
- turns
- wall-clock time
- tool calls and tool-result text volume
- valid tool-surface rate
- per-task failure modes

## Source Surface Summary

The GitHub MCP server README describes an official MCP server that lets AI tools read repositories/files, manage issues and pull requests, analyze code, monitor Actions, manage releases, and access security/team collaboration context. It supports a remote hosted server and a local server. The local server can be run from the public Docker image `ghcr.io/github/github-mcp-server`, authenticated with `GITHUB_PERSONAL_ACCESS_TOKEN`, and configured by toolsets or individual tools.

Important MCP configuration points:

- Default toolsets are `context`, `repos`, `issues`, `pull_requests`, and `users`.
- Additional toolsets include `actions`, `code_security`, `dependabot`, `discussions`, `experiments`, `gists`, `notifications`, `orgs`, `secret_protection`, `stargazers`, and others.
- Toolsets can be selected with `--toolsets` or `GITHUB_TOOLSETS`.
- Individual tools can be selected with `--tools` or `GITHUB_TOOLS`.
- `--read-only` takes priority over write tools.
- `GITHUB_HOST` / `--gh-host` can target GitHub Enterprise hosts.

The GitHub CLI manual exposes broad command groups for `gh issue`, `gh pr`, `gh repo`, `gh run`, `gh workflow`, `gh search`, and the low-level `gh api`. `gh api` is important because it is an official escape valve inside the CLI surface: it can make authenticated REST or GraphQL requests, paginate, and filter output with built-in `--jq` and `--template`.

References:

- https://github.com/github/github-mcp-server
- https://cli.github.com/
- https://cli.github.com/manual/gh
- https://cli.github.com/manual/gh_api
- https://cli.github.com/manual/gh_issue
- https://cli.github.com/manual/gh_pr
- https://cli.github.com/manual/gh_repo

## Core Methodology

Use live GitHub sandbox resources first, not a fake local GitHub API.

Reasoning:

- The point is to compare real GitHub tool surfaces, including their schemas, affordances, pagination behavior, auth behavior, and defaults.
- A fake GitHub API would be attractive for determinism, but it risks measuring compatibility gaps in the fake API instead of the MCP/CLI surfaces.
- The existing harness can still preserve isolation by using per-trial disposable repos/issues/PRs created by a controller token that the agent never sees directly.

The experiment should use an isolated GitHub owner dedicated to this benchmark, for example a private org or user account such as `cli-vs-mcp-lab`. Each trial gets a unique repo name derived from `(experiment, run, task, trial, arm)` or from a paired seed. Browser-style tempdir isolation remains useful, but the authoritative hidden state lives in GitHub and in controller-side setup metadata.

Structural advantage over the Playwright methodology: GitHub state lives off-host, so baseline cannot glob-walk the filesystem to recover answers (Playwright v1's known weakness — see `CLAUDE.md` §"Known limits"). Baseline is a clean zero-floor by construction, not by mitigation. The only way baseline could pass is if a task's expected answer leaks through the prompt, controller-side setup files copied into the workdir, or public GitHub visibility — all addressable through task design.

## Authentication Model

Use two different credentials:

- Controller token: held by the harness only. It provisions and cleans up repos, branches, issues, labels, PRs, workflow files, and hidden expected values. It is never available in the agent process.
- Agent token: available only to the arm under test. It has the minimum permissions required for the task suite against the sandbox owner.

Recommended token setup:

- Use a fine-grained PAT or GitHub App installation token restricted to the sandbox owner/repositories.
- Start with private repos so baseline cannot use public web search to infer state.
- For read-only tiers, run both MCP and CLI with read-only scopes where feasible.
- For write tiers, grant only issues, pull requests, contents, and Actions permissions needed by the selected tasks.
- Do not use a personal token with broad organization or account access.

Security risks to handle explicitly:

- `gh auth token` can reveal the agent token if `Bash(gh:*)` is allowed. Per-run rotation is the strong mitigation but requires GitHub App installation tokens (which mint per-run and expire in ~1 hour); ordinary fine-grained PATs have day-scale minimum expiries and cannot be minted per trial. The two-mode policy below applies:
  - **GitHub App mode (preferred long-term):** controller mints a fresh installation token per run, scoped to the sandbox owner. In-trial exfiltration is bounded to that run.
  - **Fine-grained PAT mode (first milestone):** one short-lived PAT scoped to the sandbox owner is reused across the run. Compensate for the lack of per-trial rotation by (a) keeping the sandbox owner truly disposable, (b) restricting the PAT to the sandbox owner's repositories only, (c) rotating the PAT manually between runs, and (d) treating any successful `gh auth token` invocation in a transcript as an incident, not just a validity violation.
- Do not put tokens in prompts, result JSONs, transcripts, or copied trial directories.
- Scrub environment snapshots if any command output includes authentication details.
- Treat CLI and MCP write tasks as real side-effecting tests. Provide cleanup that can run independently after a failed or timed-out trial.

Token-source decision (see Open Decisions): fine-grained PAT is the simpler starting point but cannot be rotated per trial. GitHub App installation tokens are the cleaner long-term answer because they expire in ~1 hour, are per-installation, and rotate naturally per run — at the cost of installation/app setup overhead. The per-run rotation guarantee above only holds in App mode.

## Arm Definitions

### baseline

No GitHub execution surface.

Allowed tools:

- `ToolSearch`
- `Read`
- `Glob`
- `Grep`
- `Write`
- `TodoWrite`

Blocked tools:

- `Bash`
- `Skill`
- `Task`
- `Agent`
- `WebFetch`
- `WebSearch`
- `Monitor`
- `CronCreate`
- `RemoteTrigger`

Expected result: baseline should fail tasks whose answers or required mutations live only in GitHub. If baseline passes, the task is likely leaking expected state through the prompt, local setup files, public GitHub visibility, or stored artifacts.

### skill

GitHub CLI skill enabled, no GitHub MCP server.

Allowed tools:

- `ToolSearch`
- `Skill`
- `Bash(gh:*)`
- `Write`
- `TodoWrite`

Blocked tools:

- `Task`
- `Agent`
- `WebFetch`
- `WebSearch`
- `Monitor`
- `CronCreate`
- `RemoteTrigger`
- all `mcp__github__*` tools

`Read`, `Glob`, and `Grep` are intentionally omitted, matching the strict Playwright skill arm (`harness/src/config.ts:78–84`). With `bypassPermissions`, those tools can walk `/Users/...` and read fixtures or other arms' artifacts. The agent must source its information from `gh` (or MCP, in the other arm) only, and produce its final JSON via `Write`.

Skill packaging:

- Lives at `.claude/skills/github-cli/SKILL.md` and is copied into the trial workdir by the runner, same mechanism as the Playwright skill.
- `gh` is not bundled; it is a system binary. The runner asserts a pinned `gh --version` at trial start and records the observed version in trial metadata. If the host `gh` doesn't match, the trial fails fast rather than silently drifting.
- `SKILL.md` should teach the agent: use `--json` + `--jq` for structured queries; use `--paginate` over manual page loops; treat `gh api` as the escape valve when high-level commands don't exist; route final artifacts through the `Write` tool, not shell redirection.

CLI rules:

- Practical mode: allow chained shell segments only when every segment is `gh ...`.
- Research mode: require exactly one `gh` command per Bash call.
- Prefer built-in `gh` formatting over shell filters: `--json`, `--jq`, `--template`, `--paginate`, and `--slurp` are valid CLI surface.
- Shell pipes to `jq`, `head`, `tail`, `sed`, `cat`, `python`, `node`, `curl`, `wget` and shell redirections (`>`, `>>`) are invalid surface in **every** mode, including practical. File output must come from the agent `Write` tool or from `gh` flags that write files directly. This matches Playwright strict-v3 routing of artifacts through `Write`.
- `gh api` is part of the CLI surface. It is allowed in `practical` and `research-single` modes, disallowed in `no-raw-api` mode, and always counted separately as `rawApiCommandCount`.
- `gh` shells to `git` internally for some commands (`gh pr checkout`, `gh repo clone`, `gh repo fork`, etc.). The validity classifier inspects only top-level shell segments, so these internal `git` invocations are part of the CLI surface and not violations.
- `Bash(gh:*)` is a single allow-list pattern; per-subcommand accounting (e.g., separating `gh api` from `gh issue`) is done by the transcript classifier, not by additional allow-list entries.

### mcp

GitHub MCP server enabled, no GitHub CLI skill and no Bash.

Allowed tools:

- `ToolSearch`
- `Write`
- `TodoWrite`
- `mcp__github__*` tools for selected toolsets

Blocked tools:

- `Bash`
- `Skill`
- `Task`
- `Agent`
- `WebFetch`
- `WebSearch`
- `Monitor`
- `CronCreate`
- `RemoteTrigger`

MCP configuration:

- Prefer the local server for pinning and reproducibility.
- Pin by Docker image digest or a specific release artifact, not a floating tag.
- Set `GITHUB_TOOLSETS` narrowly per run. Start with `context,repos,issues,pull_requests,actions`. Note: `actions` is not in the server's default toolset list; enabling it widens past defaults and must be declared explicitly in the run config and report.
- Use separate read-only and write-enabled MCP configs, not one broad server. Tier 1 uses an `--read-only` config (e.g., `.mcp.github.ro.json`); Tier 2+ uses a write-enabled config (e.g., `.mcp.github.rw.json`). The arm config selects which file to point `--mcp-config` at. This proves Tier 1 successes are non-mutating and removes a class of accidental side effects.

Allow-list shape:

- Enumerate every `mcp__github__*` tool individually in the allowed list, mirroring `harness/src/config.ts:94–116` for Playwright. The glob form (`mcp__github__*`) is brittle if Claude Code's allow-list matcher changes, and enumeration also serves as documentation of the pinned tool surface for the chosen toolset set.
- Re-generate the enumeration whenever the server digest is bumped or `GITHUB_TOOLSETS` changes.

## Harness Changes Needed

Keep these changes shared in `harness/src/`; do not fork the harness for GitHub.

1. Pluggable validity classifier.

   The current classifier in `harness/src/metrics.ts` is hard-wired to Playwright in three places: `isPlaywrightCliSegment` (line ~163), the `mcp__playwright__` prefix check (line ~201), and the `skill` arm branch in `classifyToolUse` (lines ~226–246). A rename of `usedBrowserTool` to `usedIntendedTool` is not enough.

   Extract an experiment-keyed classifier interface and thread it through `parseTranscript` and `classifyToolUse`:

   ```ts
   interface ExperimentClassifier {
     intendedMcpPrefix: string;          // 'mcp__github__'
     intendedSkillName: string;          // 'github-cli'
     intendedShellCommand: string;       // 'gh'
     invalidShellHelpers: string[];      // ['curl','wget','jq','python','node','cat','sed','awk','grep','head','tail','sh','bash','zsh','npx','npm']
     classifyShellCommand(cmd: string):
       { surfaceReason: string|null; granularityReason: string|null; rawApi: boolean };
   }
   ```

   Register one classifier per experiment (`playwright`, `github`, …). The runner picks the classifier by experiment name. `usedBrowserTool` is renamed to `usedIntendedTool` once callers migrate; no silent fork of the harness for GitHub.

2. GitHub classifier rules.

   The GitHub classifier should encode:

   - valid CLI command prefix: `gh`
   - separately-counted CLI subcommand: `gh api` (sets `rawApi: true`)
   - invalid shell helpers list as above
   - `git` is in the invalid-helper list for top-level segments. `gh` invoking `git` internally is fine because the classifier inspects only the top-level Bash command.
   - shell redirections (`>`, `>>`, `<`) invalidate the segment in every mode
   - invalid MCP tools: anything outside the enumerated `mcp__github__*` allowlist for the active toolset
   - **Tier 1 read-only mode** (additional rules on top of the above, activated when the task declares `readOnly: true`):
     - Flag obvious CLI mutators as validity violations: `gh issue edit`, `gh issue comment`, `gh issue close`, `gh issue reopen`, `gh issue delete`, `gh issue transfer`, `gh issue lock/unlock`, `gh issue pin/unpin`; `gh pr create`, `gh pr edit`, `gh pr comment`, `gh pr review`, `gh pr close`, `gh pr reopen`, `gh pr merge`, `gh pr ready`, `gh pr lock/unlock`; `gh repo create`, `gh repo delete`, `gh repo edit`, `gh repo archive`, `gh repo unarchive`, `gh repo rename`, `gh repo fork` (writes via fork creation); `gh release create`, `gh release edit`, `gh release delete`, `gh release upload`, `gh release delete-asset`; `gh label create/edit/delete/clone`; `gh workflow enable/disable/run`; `gh run rerun/cancel/delete`; `gh secret set/delete`; `gh variable set/delete`; `gh ruleset create/edit/delete`.
     - For `gh api`, flag the following as validity violations in read-only mode:
       - Explicit write method: `--method POST|PUT|PATCH|DELETE` or short form `-X POST|PUT|PATCH|DELETE`.
       - **Implicit write via parameters.** `gh api` defaults to `GET` only when no parameters are passed; once any of `-f`, `--raw-field`, `-F`, `--field`, or `--input` appears, the implicit method becomes `POST`. Flag any invocation that uses one of these flags **unless** the same invocation also passes an explicit `--method GET` (or `-X GET`) or `--method HEAD` (or `-X HEAD`). `--method GET` paired with `-f` is a legitimate read pattern: `gh api` sends those parameters as query string when the method is GET (e.g., `gh api search/issues --method GET -f q=...`).
       - `gh api` with no method flag and no parameter flag remains valid (it is an unambiguous GET). Explicit `--method GET` / `--method HEAD` is always valid.
       - The endpoint path itself is not allowlisted; GitHub returns 4xx for GET against write-only endpoints, so method discipline is enough and avoids maintaining a read-endpoint catalogue.
     - For the MCP arm in read-only mode, the `.mcp.github.ro.json` config + server-side `--read-only` is the primary boundary, but the classifier additionally flags any tool name matching known mutator prefixes (e.g., `create_*`, `update_*`, `delete_*`, `merge_*`, `close_*`, `*_review` write variants) as a violation. Maintain this list alongside the static `name → toolset` map (see Measurement Additions).
     - These rules fire **in addition to** the read-only-scoped token boundary; either alone would catch most cases, but transcript-level classification is what makes the violation visible in reports.

3. Add provisioner lifecycle hooks.

   GitHub tasks need live setup and cleanup. Extend task definitions or experiment definitions with:

   - `provision(seed, arm, trial): Promise<ProvisionedState>`
   - `cleanup(state): Promise<void>`
   - `successCheck(ctx): Promise<SuccessResult>`

   Cleanup must run in `finally`, but a separate `pnpm harness cleanup --experiment github --run <name>` command should also exist for abandoned resources.

4. Add secret-safe environment injection and `gh` ambient-state isolation.

   The runner should pass the agent token to the child process without writing it into trial artifacts, and the child must not see any pre-existing GitHub identity from the host:

   - CLI arm: `GH_TOKEN`, `GITHUB_TOKEN`, and optionally `GH_HOST`
   - MCP arm: `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOOLSETS`, and optionally `GITHUB_HOST`

   The controller token should stay in the parent harness process only.

   Ambient-state isolation (CLI arm specifically — `gh` reads config and cached credentials from outside the tempdir by default):

   - Set `GH_CONFIG_DIR` to a fresh per-trial directory inside the tempdir so the agent never sees the host user's `~/.config/gh/hosts.yml`, OAuth tokens, or aliases.
   - Scrub every inherited GitHub-related env var before injecting the trial values: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_HOST`, `GITHUB_HOST`, `GH_REPO`, `GH_PAGER`, `GH_EDITOR`, `GH_BROWSER`, `GH_FORCE_TTY`, `GH_PROMPT_DISABLED`, `GH_CONFIG_DIR` itself. Inject only the variables the arm requires.
   - Disable update notifiers and interactive prompts that would otherwise hit the network or stall: `GH_NO_UPDATE_NOTIFIER=1`, `GH_PROMPT_DISABLED=1`, `GH_PAGER=cat`. Also pass `--no-prompt` or equivalent at command boundaries where the runner controls invocation.
   - At trial start, assert `gh auth status --hostname <host>` resolves to exactly one identity: a single host, a single authenticated login, and that login equals a configured `expectedAgentLogin` (the bot user, machine user, or GitHub App installation account the harness is supposed to be acting as). The sandbox owner (e.g., the org `cli-vs-mcp-lab`) is typically *not* the authenticated login — orgs don't authenticate; bots and Apps do. Separately assert that this identity can read the sandbox owner's namespace by round-tripping `gh api repos/{sandboxOwner}/{provisionedRepo}` (or `gh api orgs/{sandboxOwner}` for org-level access). If either assertion fails — wrong login, multiple identities, or no access to the sandbox owner — fail the trial before the prompt is sent. Record both the asserted login (`ghAuthLogin`) and the sandbox owner (`sandboxOwner`) in trial metadata.
   - The MCP arm has analogous risk if the Docker image inherits host credentials via mount; mount no host paths into the MCP server container, and pass only the explicit env vars listed above.

5. Add GitHub run configuration.

   Put sandbox owner, token env var names, repo visibility, retention policy, and toolset selection in a config file or environment-driven config object. Do not hardcode a personal owner or token.

6. Add artifact retention policy.

   Trial output dirs should keep local answer files and transcripts, but not local clones, `.git/config` files with remote URLs containing credentials, or token-bearing logs.

7. Provisioning latency budget and repo-reuse policy.

   GitHub repo creation under a fine-grained PAT is ~1–3s plus replication delay before the new repo is queryable by `gh` or MCP. A naive per-trial provisioning model costs `tasks × arms × N` repos per run; Tier 1 alone at N=3 with 3 tasks is 27 repos, and Tier 2 with mutations compounds this.

   Policy:

   - Tier 1 (read-only) tasks: provision one repo per `(task, seed)` and reuse across arms. Reads cannot mutate, so cross-arm interference is impossible. The seed→content function must be deterministic.
   - Tier 2+ (mutation) tasks: per-trial repos, no sharing across arms or trials.
   - The provisioner records `repoUrl`, `commitShas`, and `provisioningMs` in trial metadata so latency is visible in reports.
   - Before declaring a repo "ready", the provisioner waits until a `gh api repos/{owner}/{repo}` round-trip succeeds, not just until `gh repo create` returns. GitHub eventual consistency around new repos is real and arm-asymmetric.

## Proposed Task Suite

Use paired seeds so every arm sees equivalent initial GitHub state. The general rule is **independent repos per arm with identical generated content**, so one failed write cannot poison another arm. The only exception is Tier 1 read-only tasks, which may share one repo per `(task, seed)` across arms because no arm has any write capability against it (see the Tier 1 read-only token constraint in §"Tier 1 read-only token discipline" below, and the provisioning-budget rationale in §"Provisioning latency budget and repo-reuse policy"). Tier 2+ mutation tiers always get per-trial, per-arm repos.

### Tier 1 read-only token discipline

For Tier 1, both the CLI arm and the MCP arm must run with a read-only-scoped agent token, not just the MCP arm via `--read-only` config. Concretely:

- The CLI arm uses an agent token whose permissions on the sandbox owner are read-only (e.g., a fine-grained PAT with `Contents: read`, `Issues: read`, `Pull requests: read`, `Metadata: read`, and no write permissions). `gh issue edit`, `gh pr comment`, `gh repo create`, etc. should fail at the API layer, not just by classifier rules.
- Add `Actions: read` **only** when the task suite includes Actions-dependent tasks (e.g., `tier1_actions_failure`). The first milestone deliberately excludes Actions, so the milestone token does not need it. Keep the permission set minimal per run: enabling Actions read by default would widen the surface unnecessarily and make permission-related failures in the Actions task look like tool-surface failures.
- The MCP arm continues to use the `.mcp.github.ro.json` config with `--read-only`.
- Combined with this, the shared `(task, seed)` repo reuse policy is safe: even if a Tier 1 prompt accidentally encourages a write, neither arm has the credentials to mutate the shared repo.
- Classifier rules still flag write attempts as validity violations, but they are not the *only* line of defense — the token boundary is.

### Tier 1: read-only GitHub inspection

Task `tier1_repo_inventory`

- Setup: create a private repo with deterministic files, topics, branch names, labels, and release/tag metadata.
- Prompt: ask the agent to identify specific repository facts and save JSON.
- Expected CLI path: `gh repo view`, `gh api`, maybe `gh repo list`.
- Expected MCP path: repo and file-content tools.
- Success: compare output JSON to controller-side expected values.
- Purpose: basic repository metadata and file inspection.

Task `tier1_issue_triage`

- Setup: create 8-12 issues with deterministic labels, bodies, comments, assignees, and timestamps. One issue contains a hidden marker pattern in a comment/body.
- Prompt: find the issue matching a compound condition and save issue number, title, labels, and marker.
- Expected CLI path: `gh issue list --json`, `gh issue view --comments`, `gh api`.
- Expected MCP path: issue list/read tools.
- Success: exact match.
- Purpose: structured search over issue state without mutation.

Task `tier1_pr_diff_answer`

- Setup: create a base branch and a PR branch with deterministic changes across multiple files. Open a PR.
- Prompt: inspect the PR diff and answer which file/function changed in a specific way.
- Expected CLI path: `gh pr view --json`, `gh pr diff`.
- Expected MCP path: pull request tools plus file/diff tools if available.
- Success: exact JSON answer.
- Purpose: compare diff retrieval and summarization cost.

Task `tier1_actions_failure`

- Setup: create a workflow run or stored failed check data in a sandbox repo. Prefer real Actions if reliable; otherwise use a committed workflow log artifact or a failed check suite created by API if available.
- Prompt: identify the failing job/step and extract the error marker.
- Expected CLI path: `gh run list`, `gh run view --log`.
- Expected MCP path: actions toolset.
- Success: exact failure marker and job/step.
- Purpose: CI log navigation and larger output handling.

### Tier 2: state mutation and verification

Task `tier2_issue_workflow`

- Setup: create a repo with labels and 3 candidate issues.
- Prompt: find the issue matching a generated condition, add a label, leave a comment containing a specified generated phrase, and close it.
- Expected CLI path: `gh issue list/view/edit/comment/close`.
- Expected MCP path: issues tools.
- Success: controller verifies issue state, label, comment body, and closed status.
- Purpose: multi-step mutation, issue identity, and idempotency.

Task `tier2_pr_review`

- Setup: create PR with deterministic diff and review instructions. **The PR author identity must be distinct from the agent's identity.** GitHub refuses `APPROVE` and `REQUEST_CHANGES` reviews from the PR author, so if both the controller and the agent token resolve to the same user/installation, the task measures GitHub's self-review policy instead of the tool surface. Use one of: (a) a second sandbox bot account as the PR author with the agent token belonging to a different account, or (b) two distinct GitHub App installations (controller installation opens the PR, agent installation reviews), or (c) a human-owned controller account paired with a bot agent account. Record both identities in trial metadata as `prAuthorLogin` and `ghAuthLogin` and assert they differ at provisioning time.
- Prompt: inspect the PR, leave a review/comment that identifies a generated concern, then request changes or approve depending on condition.
- Expected CLI path: `gh pr view`, `gh pr diff`, `gh pr review`.
- Expected MCP path: pull request tools.
- Success: controller verifies review event/comment and decision.
- Purpose: PR read/write loop with diff context.

Task `tier2_file_patch_pr`

- Setup: create repo with a file containing generated TODOs and a protected main branch policy if feasible.
- Prompt: create a branch, update a file with the generated correction, and open a PR with a specified title/body marker.
- Expected CLI path: likely `gh api` for contents or `gh repo clone` + `git` would be tempting. To keep this a GitHub-surface comparison, design the prompt and allowlist so the CLI path uses `gh api repos/{owner}/{repo}/contents/...` rather than local `git`.
- Expected MCP path: repository content mutation and pull request tools.
- Success: controller verifies branch file content and PR metadata.
- Purpose: content mutation without letting local `git` dominate the task.

Task `tier2_release_note`

- Setup: create commits/tags/releases or deterministic milestone issues.
- Prompt: create or update a draft release with generated notes extracted from issues/PRs.
- Expected CLI path: `gh release create/edit`, `gh issue/pr view/list`.
- Expected MCP path: repos/releases tools if available, otherwise this task may be deferred.
- Success: controller verifies release title/body/tag and generated markers.
- Purpose: multi-object synthesis and write.

### Tier 3: mixed coding-agent workflow

Task `tier3_bugfix_from_issue`

- Setup: local temp repo contains code and tests; GitHub sandbox repo contains an issue with reproduction details and a target branch/PR requirement.
- Prompt: read the GitHub issue, modify local code, run tests, commit/create a PR or update a file via GitHub API depending on allowed surface.
- Expected CLI path: `gh issue view`, local file tools/test commands if this tier intentionally allows them, `gh pr create` or `gh api`.
- Expected MCP path: GitHub issue/PR tools plus local file/test tools.
- Success: local tests pass and GitHub PR/issue state matches expected.
- Purpose: test the original hypothesis that CLI may win when GitHub work is interleaved with local code context.

Task `tier3_ci_repair_loop`

- Setup: PR has failing CI due to a generated test failure. Local workspace can reproduce it.
- Prompt: inspect CI failure, patch code, rerun tests, update PR/comment.
- Success: local tests pass and GitHub PR comment/update references correct generated marker.
- Purpose: mixed remote CI inspection plus local repair.

Tier 3 should not be attempted until Tier 1 and Tier 2 validity are stable, because it introduces legitimate local `Bash` and possibly `git`, which complicates the CLI-vs-MCP boundary.

## Success Checks

Read tasks:

- Agent writes a local JSON or text artifact in `outputDir`.
- Harness compares against hidden provisioned state and, where useful, controller-fetched GitHub state.

Write tasks:

- Harness verifies live GitHub state using the controller token.
- Required mutations must include per-trial generated markers so stale artifacts and copied answers cannot pass.
- Scoring should be partial but strict:
  - correct target object selected
  - required mutation applied
  - generated marker present
  - no wrong object mutated
  - idempotency or duplicate side effects if relevant

Always record task-specific extras:

- repos created
- issues created/mutated
- PRs created/mutated
- comments created
- labels changed
- workflow run IDs inspected
- cleanup status

## Validity Rules

A trial is valid if every tool call stays within the intended arm surface.

CLI practical validity:

- Every top-level shell segment starts with `gh`.
- No top-level shell pipes or helpers outside `gh`.
- `gh --json`, `gh --jq`, `gh --template`, `gh api --jq`, and `gh api --paginate` are valid.
- `gh api` is valid but counted in a separate `rawApiCommandCount`.
- Shell redirections (`>`, `>>`, `<`) are always invalid in every mode, including practical. This matches the rules in §"Arm Definitions / skill / CLI rules" and §"Run Modes / practical". Final artifacts must come from the agent `Write` tool, or from `gh` flags that write files directly (e.g., `gh run download -D <dir>`) — those flags are part of the CLI surface, not shell plumbing.

CLI research validity:

- Exactly one `gh` invocation per Bash call.
- No shell chaining, pipes, redirections, substitutions, aliases, or helper commands.

MCP validity:

- Every GitHub operation must use `mcp__github__*`.
- No `Bash`, `Skill`, `WebFetch`, `WebSearch`, `Task`, `Agent`, `Monitor`, `CronCreate`, or `RemoteTrigger`.

Baseline validity:

- No network or execution surface.
- Baseline can write guesses but cannot inspect or mutate GitHub.

## Measurement Additions

Keep existing token/turn metrics and add GitHub-specific counters:

- `usedIntendedTool`
- `rawApiCommandCount` for `gh api`
- `highLevelGhCommandCount` for `gh issue`, `gh pr`, `gh repo`, `gh run`, `gh workflow`, `gh release`
- `mcpToolsetCounts` grouped by tool prefix/toolset if names make that possible
- `toolResultTextTokens` estimated from transcript tool-result payloads
- `liveMutationCount` from controller-side success checks
- `cleanupSucceeded`
- `provisioningMs` per trial and `provisioningRoundtripMs` for the readiness check
- `ghVersionObserved` and `mcpServerDigestObserved` recorded once per run

Caveat on `mcpToolsetCounts`: github-mcp-server tool names don't carry their toolset (`mcp__github__list_issues`, not `mcp__github__issues__list`). The counter requires a static `name → toolset` map maintained alongside the pinned server digest and re-generated whenever `GITHUB_TOOLSETS` or the digest changes.

Caveat on per-tool token comparison: MCP tool results and `gh --json` output are both JSON serialized into the assistant transcript, but their default verbosity differs (whitespace, field selection, embedded patches vs unified diffs). `toolResultTextTokens` must be reported **per tool name or prefix**, not aggregated, or the comparison will quietly bias toward whichever surface happens to be terser by default.

Optional later instrumentation:

- Count GitHub API requests through a proxy or by wrapping `gh`/MCP network calls. Do not add this in the first pass unless token/turn results are ambiguous.

## Run Modes

Use three run modes analogous to Playwright strict-v3.

### practical

High-level default comparison.

- CLI may use multiple `gh` commands in one Bash call if every top-level segment is `gh`.
- CLI may use `gh api` (counted separately as `rawApiCommandCount`).
- CLI may use built-in formatting flags (`--json`, `--jq`, `--template`, `--paginate`, `--slurp`).
- Shell redirections (`>`, `>>`) are **not** allowed even in practical mode. Final artifacts go through the `Write` tool. This matches Playwright strict-v3 and keeps the comparison about CLI/MCP affordances, not shell plumbing.
- Reports include all trials in per-task tables and valid-only aggregation for tier/crossover.

### no-raw-api

Tests whether the high-level CLI surface alone competes with MCP.

- Same as practical, but `gh api` is counted invalid for the skill arm.
- This is not necessarily more "fair"; it answers a different question about command affordances.

### research-single

Round-trip accounting comparison.

- One `gh` command per Bash call.
- No shell chaining.
- `gh api` can be allowed or disallowed as a sub-mode, but the report must label it clearly.

## Reporting Questions

The report should explicitly answer:

- Do both GitHub arms pass the same tasks?
- Does baseline remain at zero on non-leaky tasks? (Should be a hard zero — GitHub state is off-host.)
- Does MCP use fewer tokens because schemas/results are compact, or does CLI use fewer tokens because `gh --json/--jq` compresses output?
- Does `gh api --jq` create a token advantage analogous to Playwright CLI defensive truncation?
- Does MCP require more turns because the agent must inspect tool schemas and perform one action per call?
- Do write tasks show fewer duplicate side effects on one surface?
- Does Tier 3 flip the result when GitHub work is mixed with local code/test context?

Reporting must avoid apples-to-oranges artifacts. Call out and, where possible, normalize:

- **Diff shape mismatch.** `gh pr diff` returns a single unified diff; the MCP equivalent (e.g., `get_pull_request_files`) returns per-file patches. Token count comparison without shape normalization will misattribute the difference. Report raw `toolResultTextTokens` per tool *and* a normalized "minimum useful diff" token count derived from a canonical re-serialization.
- **Default page-size mismatch.** `gh issue list` defaults differ from `mcp__github__list_issues`. Record observed page sizes per tool call; do not aggregate.
- **JSON verbosity mismatch.** Both surfaces return JSON, but MCP server output may include schema-level wrapping or fields that `gh --json <fields>` omits. Report `toolResultTextTokens` per tool name or prefix, not aggregated.
- **`gh api` dominance.** If `rawApiCommandCount` is a large fraction of skill-arm tool calls, the report should also produce a `gh api`-excluded view so high-level CLI affordances aren't drowned by raw API access.

## Implementation Sequence

1. Create a sandbox GitHub owner and token policy.

   Define the owner, token scopes, cleanup expectations, and retention policy before writing task code. Confirm private repo creation, issue/PR creation, Actions visibility, and cleanup can be done by a controller script.

2. Prototype `verify-arms` for GitHub.

   Add only enough config to ask each arm what GitHub tools it sees. Confirm:

   - baseline has no GitHub execution path
   - skill sees only GitHub CLI skill / `Bash(gh:*)`
   - mcp sees only `mcp__github__*`

3. Implement GitHub provisioner hooks in the shared harness.

   Add setup/cleanup without changing Playwright behavior.

4. Implement Tier 1 read-only tasks.

   Start with `repo_inventory`, `issue_triage`, and `pr_diff_answer`. Run N=1 smoke matrix, then N=3.

5. Tighten validity classifier.

   Inspect transcripts for unexpected CLI patterns and MCP tool exposure. Only then freeze practical validity rules.

6. Implement Tier 2 mutation tasks.

   Add `issue_workflow` and `pr_review` first. Defer `file_patch_pr` until the boundary around `git` vs `gh api` is settled.

7. Generate strict reports.

   Produce practical, no-raw-api, and research-single reports with valid-only aggregation.

8. Decide whether Tier 3 is worth building.

   Build Tier 3 only if Tier 1/2 reveal a meaningful cost or reliability tradeoff worth retesting in mixed local/remote work.

## Open Decisions

- Should the CLI arm allow `gh api` by default? Recommendation: yes in practical mode, no in the separate `no-raw-api` mode.
- Should local `git` be allowed in any GitHub task? Recommendation: no for Tier 1/2, yes only in Tier 3 where the task is explicitly mixed local coding work. `gh` invoking `git` internally is always allowed (classifier sees only top-level segments).
- Should the MCP arm use the hosted remote server or local Docker server? Recommendation: local pinned server first for reproducibility; hosted server can be a later comparison.
- Should tasks use private or public repos? Recommendation: private repos to protect baseline validity and reduce web-search leakage.
- Should Actions tasks use real workflow runs? Recommendation: use real runs only after smoke testing rate limits and latency. If they are too flaky, defer Actions to a separate tier.
- How should cleanup failures be handled? Recommendation: never hide them. Mark trial success independently from cleanup, but report cleanup failures loudly and provide a cleanup command.
- PAT or GitHub App for the agent token? Recommendation: fine-grained PAT for the first milestone (simpler setup), with the explicit understanding that PATs cannot be minted per trial — per-run rotation is manual and between-run only. Migrate to GitHub App installation tokens once the harness is stable to get genuine per-run rotation; App tokens are ~1-hour, finer-grained per repo, and mint naturally per run. See §"Authentication Model" for the two-mode policy.
- Per-trial or per-`(task, seed)` repos? Recommendation: per-`(task, seed)` and reuse across arms for Tier 1 (read-only) tasks; per-trial repos for Tier 2+ mutation tasks. This bounds repo-creation latency under rate limits without compromising mutation isolation.
- Archive or delete on cleanup? Recommendation: **archive** via the controller token. Fine-grained PATs typically lack delete-repo permission (account-admin scope), so relying on delete creates a permission cliff. Run a separate periodic admin-token sweep that deletes archived sandbox repos older than N days.

## Main Risks

- GitHub API rate limits and eventual consistency may create wall-clock noise.
- Fine-grained PAT permissions can differ subtly between CLI and MCP calls.
- `gh api` may dominate the CLI result and make high-level CLI commands irrelevant.
- MCP tool names and schemas may change if the server is not pinned.
- Write tasks can leave resources behind after timeouts.
- Private repo visibility is required for baseline isolation, but private repos may require paid/org-specific permissions depending on the account.
- GitHub Actions tasks may be slow enough that wall-clock comparisons become mostly queue-time measurements.

## First Milestone Definition

The first useful milestone is not a full benchmark. It is a validity smoke matrix:

- Experiment: `github`
- Tasks: `tier1_repo_inventory`, `tier1_issue_triage`, `tier1_pr_diff_answer`
- Arms: `baseline`, `skill`, `mcp`
- Trials: `N=1`
- Pass gate (all required to advance to N=3 and Tier 2):
  - baseline: 0/3 pass, 3/3 valid surface
  - skill: 3/3 pass, 3/3 valid surface, CLI arm running under a read-only-scoped agent token (no write permissions on the sandbox owner)
  - mcp: 3/3 pass, 3/3 valid surface, MCP arm running under `--read-only` config
  - 0 cleanup failures across all 9 trials
  - 0 controller-token references in any trial artifact or transcript
  - `ghVersionObserved`, `mcpServerDigestObserved`, `ghAuthLogin`, and `sandboxOwner` recorded; `ghAuthLogin` equals the configured `expectedAgentLogin` on every trial and has verified access to `sandboxOwner`; pinned versions match
  - `provisioningMs` p95 within an explicitly recorded budget (set on first run, then frozen)

Only when every bullet above is green does the benchmark advance to N=3 and Tier 2. Soft fails (e.g., one cleanup failure) require an investigation note before continuing, not a silent advance.
