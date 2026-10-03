# Audit: cli-vs-mcp

Audit date: 2026-10-02. Branch: `hardening/2026-10-02`. Base: `main` @ `c5552ce`.
Scope: every tracked file, the repo description, and the GitHub Pages site served from `main:/docs`.
Nothing in the repo was changed during this audit except adding this file.

Evidence conventions: `file:line` points into this branch. "Recomputed" means re-derived from the committed per-trial
result JSON (`experiments/*/runs/*/results/**/<n>.json`) with a script, or from the harness's own `report` command run
in a clean clone.

---

## 1. What the project does (from the code)

`harness/src/cli.ts` runs a single Claude Code task many times under three tool configurations (no execution tools,
a CLI wrapped as a Claude Code Skill, or an MCP server). Each trial runs `claude -p` in a fresh temp directory against
per-trial synthetic state: an in-process HTTP fixture server for Playwright, or a throwaway private GitHub repo for
GitHub. The harness records the stream-json transcript, parses it into token, turn, and time metrics, classifies every
tool call as inside or outside the arm's intended surface, and runs a task-specific success check.
A `report` command aggregates the stored results into markdown tables that compare the arms.

---

## 2. Accuracy

### 2a. README.md

| # | Claim | Status | Evidence |
|---|---|---|---|
| R1 | Three arms baseline / skill / mcp | Verified | `harness/src/experiment.ts:4` |
| R2 | Playwright MCP arm uses `@playwright/mcp@0.0.75` via stdio | Verified | `.mcp.playwright.json` |
| R3 | GitHub MCP arm uses digest-pinned `ghcr.io/github/github-mcp-server` | Verified | `.mcp.github.*.json`. The digest resolves to release **v1.0.4** (matched against GHCR tag manifests) |
| R4 | "Records tokens, turns, wall-clock time, success score, and tool-surface validity" | Verified, with a defect | `metrics.ts:157-262`. **On timeout, tokens and wall-clock are recorded as 0**; see W1 |
| R5 | Paired seed `hash(experiment, runName, taskId, trialN)`; all arms see the same state | Verified | `trialState.ts:46-51`, `runner.ts:163` |
| R6 | "Computes a paired seed … → 16 hex via **FNV-1a**" | **Wrong** | The paired seed is SHA-256 truncated to 16 hex (`trialState.ts:47`). FNV-1a only seeds the PRNG from that string (`trialState.ts:24-26`) |
| R7 | Per-trial answers stay off disk (fixtures rendered from memory; GitHub state in sandbox) | Verified | `fixtureServer.ts:53-59`, `runner.ts:166-171` |
| R8 | Agent runs with "a positive `--allowed-tools` list"; the per-arm "Allowed" tables; skill arm has "`Read/Glob/Grep` intentionally omitted" | **Wrong** | Under `--permission-mode bypassPermissions`, `--allowed-tools` does not restrict the tool set. The `init` event of committed transcripts (Claude Code 2.1.143) lists `Read Glob Grep Edit NotebookEdit AskUserQuestion Cron* Task* EnterWorktree…` in **all three arms**. Only `--disallowed-tools` removed anything. A fresh run on Claude Code 2.1.287 also exposes `Workflow`, `SendMessage`, `ListAgents`. See S1 |
| R9 | `--setting-sources project,local` keeps the developer's `~/.claude` skills out | **Partly wrong** | User skills are excluded, but built-in skills still load (`init.skills` shows `update-config, simplify, loop, schedule, claude-api…`) |
| R10 | Five tools always blocked (WebFetch, WebSearch, Monitor, CronCreate, RemoteTrigger) | Verified | `experiments/*.ts` `ALWAYS_BLOCKED`; absent from every `init.tools` |
| R11 | Model `claude-sonnet-4-6`, configurable via `--model` | Verified | `cli.ts:42`; transcripts show `model: claude-sonnet-4-6` |
| R12 | Child killed after 240 s (`runner.ts:TRIAL_TIMEOUT_MS`) | Verified | `runner.ts:191` |
| R13 | Repo layout tree: "github/tasks/ — tier1.ts (3 tasks), index.ts" | **Wrong** | tier1.ts has 4 tasks, and `tier2.ts` (4 tasks) is missing from the tree |
| R14 | Playwright tier1 has 4 tasks, tier2 has 2 | Verified | `experiments/playwright/tasks/tier*.ts` |
| R15 | `verify-arms` "probes each arm by asking the agent which tools it can see"; "The verified surfaces:" | **Wrong / misleading** | The probe runs with `cwd = repo root` (`cli.ts:271`), not a trial tempdir, so it sees the repo's `CLAUDE.md` and both bundled skills. It reports the model's self-description, not the actual tool list. The tables beneath it are the configured lists, not what was verified (see R8) |
| R16 | Playwright MCP arm: "23 enumerated `mcp__playwright__*` tools" | Verified | `playwright.ts:70-92`; `verify-arms` run on 2026-10-02 listed the same 23 |
| R17 | `tier1_login` expects a PNG ≥ 1 KB | Verified | `experiments/playwright/tasks/tier1.ts:115` |
| R18 | GitHub repo names `clivsmcp-<task>-<seed8>` | Verified | `provisioner.ts:229-232` (underscores become dashes) |
| R19 | Result JSON schema block lists `numTurns` | **Wrong** | Removed in `b3e5729`; not in `Metrics` (`metrics.ts:14-41`) |
| R20 | `toolCalls[] # [{ name, turnIndex, command?, reason? }]` | **Wrong (minor)** | `reason` exists only on `escapeToolCalls[]` and `cliCommandGranularityViolations[]` |
| R21 | Classifier, mcp arm: "only Write, TodoWrite, ToolSearch, and the intended `mcp__<prefix>__*` set are valid" | **Wrong** | The mcp classifier rejects only `Bash/Skill/Task/Agent` and the always-blocked tools (`metrics.ts:122-128`). `Read`, `Glob`, `Grep`, `Edit`, `ReadMcpResourceTool`, `Workflow` and others all pass. In n5, 5 MCP `tier1_issue_triage` trials used `Read/Glob/Grep` and were counted valid (all 5 failed, so headline numbers are unchanged) |
| R22 | Classifier, skill arm: Skill must match; Bash must satisfy `classifyShellCommand` | Verified, but incomplete | Same gap as R21: non-Bash tools other than Task/Agent pass |
| R23 | "Shell redirections (`>`, `>>`, `2>&1`) invalidate the segment in every mode" | **Wrong** | Both classifiers strip simple redirections before checking (`shell.ts:64-69`, `github.ts:48`, `playwright.ts:10`). `gh issue list > out.txt` is surface-valid in practical mode and only a granularity violation |
| R24 | Shell helpers list (`curl, wget, cat, python, sed, awk, head, tail, jq, base64`, etc.) | **Wrong (minor)** | `base64` is not in either `INVALID_HELPERS_RE` (`github.ts:13`, `playwright.ts:7`). The n5 `base64 -d` escapes were caught only because they were separate non-`gh` pipe segments |
| R25 | Run modes practical / research-single, `--single-cli-command` on `run` and `report` | Verified | `cli.ts:43,137` |
| R26 | Setup: put the three GitHub vars "in a gitignored .env at repo root" | **Wrong** | Nothing loads `.env` (no dotenv, no `--env-file`). Preflight fails unless the vars are exported in the shell |
| R27 | "Playwright is ready out of the box" after `pnpm install` | Unverifiable on a clean machine | Works here, but this machine already has Playwright browsers cached. Prerequisites (Node, pnpm, `claude` CLI logged in, Docker for GitHub) are not listed |
| R28 | CLI table: `verify-arms` optional `--arm (defaults to all arms)` | **Wrong** | `verify-arms` has no `--arm` option; it has `--model`. `pnpm harness verify-arms --experiment playwright --arm mcp` → `error: unknown option '--arm'` |
| R29 | CLI table: other `run` / `report` / `recompute-metrics` options | Verified | `cli.ts` |
| R30 | Playwright n5: T1 baseline 0/20, skill 20/20, mcp 20/20; T2 baseline 0/10, skill 10/10, mcp 7/10 (`tier2_recovery` 2/5) | Verified | Recomputed |
| R31 | Playwright baseline failures are "(timeouts)" | **Partly wrong** | T1: 17/20 timed out (3 `tier1_login` trials ended without timing out); T2: 10/10 |
| R32 | Playwright Skill/MCP token ratio T1 **1.64×** | Verified | `report` in clean clone; unaffected by W1 |
| R33 | Playwright Skill/MCP token ratio T2 **2.01×** | **Wrong (artifact of W1)** | Reproduced by `report`, but the MCP average includes 3 timed-out `tier2_recovery` trials recorded at **0 tokens**. Excluding timeouts gives **1.52×** |
| R34 | "MCP is consistently cheaper … skill emits explicit snapshot after every action; MCP bundles it inline" | Ratio verified at tier level; mechanism unverified | Each Playwright task has MCP < skill in valid non-timeout trials. The mechanism is an interpretation; no measurement isolates it |
| R35 | MCP `tier2_recovery` has a convergence failure mode "at 240 s" | Verified, with caveat | 3/5 MCP trials timed out at 240 s, but after only 3–9 turns, so "convergence" (looping) is not shown. They stalled |
| R36 | GitHub T1 table (inventory 0/5·5/5·5/5; triage 0/5·5/5·0/5; pr_diff 0/5·5/5·5/5; workflow not run·5/5·5/5) | Verified as counts; **misleading for triage** | Raw pass counts match. But on `tier1_issue_triage` the n5 agent PAT had **no Issues read access**: every `gh issue list` (skill) and every `list_issues`/`issue_read`/`search_issues` (mcp, 5–29 per trial) returned 403 "Resource not accessible by personal access token". The skill passes came from escalated credentials (R38) |
| R37 | "Skill arm escapes its surface on 2/3 GitHub tasks" (repo_inventory 5/5 invalid, issue_triage 5/5 invalid) | Verified | Recomputed: 0/5 valid on both |
| R38 | **One** trial ran `env \| grep -i github` then `GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api …` | **Wrong (understated)** | All 5 skill passes used credentials other than the agent token. Trials 1, 3 and 5 used `$GITHUB_CONTROLLER_TOKEN` (`GH_TOKEN=…` or `curl -H "Authorization: token ${GITHUB_CONTROLLER_TOKEN}"`). Trials 2 and 4 used the developer's own `gh` keyring login (`gh auth token`, `GH_TOKEN="" gh api`). The escalated calls returned the target issue, and the trials passed |
| R39 | Scrub fix "Patched in **`ef3fc97`**" | **Wrong** | No such commit in this repo. The fix is `90d0dd7`; verification artifacts are in `f2f1e59` |
| R40 | Scrub fix "behaviorally verified in `env-fix-verify`" | **Wrong** | The single post-fix trial passed by running `GITHUB_TOKEN="" GH_TOKEN="" gh api …/issues`. That makes `gh` fall back to the developer's keyring login. The scrub closed the controller-token path but not the keyring path (S3) |
| R41 | MCP `tier1_issue_triage` "collapse … the MCP fanout shape is the failure mode, not the absence of capability"; "75+ turns" | **Wrong** | The cause was the token, not fan-out: every issue endpoint returned 403 (R36). The smoke run with a different token passed in 8 turns. Turns were 58, 75, 76, 78, 77 |
| R42 | Skill solved triage "in ~23 turns" with "one `gh issue list --label … --json`" | **Wrong** | Mean 23.4 turns is right, but every `gh issue list` call in all 5 trials failed with a 403. The answer came from escalated `gh api` / `curl` calls (R38) |
| R43 | GitHub T2 table (issue_workflow, file_patch_pr, issue_create, directed 3/5 / 2/5) | Verified | Recomputed. Directed: 3/5 pass, 2/5 valid surface, **1/5 pass and valid** |
| R44 | Directed prompt "**triples the cost**" | **Wrong** | Non-timeout directed trials average 353,047 total tokens vs 143,875 undirected = **2.45×**. Across all 5 (2 timeouts at 0 tokens) it is 1.47× |
| R45 | Clean GitHub cost ratios 1.13× / 1.32× / 1.31× / 1.38× | Verified | Recomputed: 76,880/67,881; 73,146/55,534; 53,760/41,169; 106,912/77,645 |
| R46 | Known limit: controller and agent tokens resolved to the same user in n5 | Unverifiable from the repo | Plausible from transcripts (`gh auth status` shows one account) |
| R47 | Known limit: "an agent could in principle walk `/Users/...`" | **Understated** | It happened. Baseline agents made 436 out-of-tempdir `Read`/`Glob`/`Grep` calls into the home directory, and those results are committed. See S2 |
| R48 | "Adding a new experiment" steps | Verified | Matches `experiment.ts` and `experiments/index.ts` |
| R49 | GitHub preflight error: "See README.md 'Running the GitHub experiment'" | **Wrong** | No such section (`github.ts:249`) |

### 2b. Repository description

> "Harness comparing Claude Code performance across CLI skill, MCP server, and baseline tool surfaces. Playwright and GitHub experiments with N=5 runs."

Verified. Every headline run is N=5; smoke runs are N=1.

### 2c. docs/ (GitHub Pages)

182 claims across the six content pages (`docs/index.html` is a redirect): **Verified 113, Wrong 58, Unverifiable 11**. The most consequential Wrong items match README items R33, R36–R44: the GitHub issue-triage story (permissions failure and escalated credentials, not fan-out), the env-scrub verification, the Playwright Tier 2 ratio, the Playwright cost mechanism (per-field `fill` versus batched `browser_fill_form`, not snapshot-per-action), and the directed-prompt figures. Two cited commits do not exist (`ef3fc97` → `90d0dd7`; `64f9436` → `e836d26`). All internal links and images resolve, the pages contain no external links, and no employer names appear.

Page keys: **OV1** = cli_mcp_experiments.html, **OV2** = cli_mcp_experiments_v2.html, **GH1** = github_experiment.html, **GH2** = github_experiment_v2.html, **PW1** = playwright_experiment.html, **PW2** = playwright_experiment_v2.html.

Evidence helpers (audit-time scripts, not committed; Phase 2 adds a committed equivalent):
- `agg.mjs`: per run/arm/task aggregation over the 229 tracked `results/**/<n>.json` files (pass, valid, pass&valid, timeouts, token/turn/wall averages for all trials, non-timeout trials, and passing trials, singleCli count, turn list).
- `classify-check.ts`: runs the current `buildGitHubClassifier` and the Playwright classifier on sample commands, then re-parses **all 229 stored transcripts** with the current `parseTranscript`. Result: **0 validity/granularity diffs** against stored results. (Stored `reason` strings in GitHub n5 still say "shell redirection:", because they came from the classifier before f73b1ca. Only the reason text is stale; the booleans hold.)
- `seq.mjs` / `ctl.mjs`: print tool_use and tool_result sequences from a transcript.
- Token totals = input + cached + cacheCreation + output. A "timeout" is a trial with `error` set. Every timeout records 0 tokens and wallClockMs = 0.

Status counts (first status token per row; mixed rows counted by their first label): **Verified 113 · Wrong 58 · Unverifiable 11** (182 rows)

---

#### 1. Shared harness / method claims (OV1, OV2, GH1, PW1)

| # | Claim (short quote) | Page(s) | Status | Evidence |
|---|---|---|---|---|
| H1 | Three arms: baseline / skill / mcp | all | Verified | experiments/*.ts `buildArms`/`arms` |
| H2 | Baseline allowed tools "ToolSearch Read Glob Grep Write TodoWrite" | GH1, PW1 | Verified (config) | github.ts:180, playwright.ts:44 |
| H3 | Baseline has "only Read, Write, Glob, Grep" | OV1 | Wrong | Allow-list also has ToolSearch and TodoWrite. Under bypassPermissions, init events also expose Edit, NotebookEdit, AskUserQuestion, Task*, Cron*, EnterPlanMode and others. Baseline trials used EnterPlanMode, TaskCreate and AskUserQuestion (agg of toolCalls) |
| H4 | Skill: "tightly scoped Bash allow-list that restricts shell access to that binary" / "narrow Bash(gh:*)" | OV1, OV2, GH1, PW1 | Wrong | `Bash(gh:*)` does not restrict anything under bypassPermissions. Skill trials ran `env`, `curl`, `base64 -d`, `python3`, `echo $GH_TOKEN` and got results (n5 skill tier1_issue_triage 1–5, tier2_file_patch_pr 1–5). The classifier only flags these after the fact |
| H5 | Skill arm "Read/Glob/Grep are intentionally omitted" | GH1 | Wrong (misleading) | Left off the allow-list, but present in the init `tools` list for every skill trial (CC 2.1.143, bypassPermissions) and never flagged by metrics.ts:130-152 |
| H6 | MCP arm "No Bash, no Skill — only the enumerated MCP tool set" | OV1, OV2, PW1, PW2 | Wrong (partially) | Bash and Skill are disallowed (github.ts:205, playwright.ts:94). However, GitHub mcp trials used Glob ×8, Grep ×8, Read ×6, ReadMcpResourceTool ×17 and ListMcpResourcesTool ×8, and MCP issue_create/workflow trials called `mcp__github__issue_write`, which is not on the allow-list |
| H7 | Playwright mcp: "23 enumerated tools" | OV1, PW1 | Verified | playwright.ts:70-92 (23 entries) |
| H8 | `@playwright/mcp@0.0.75` via npx stdio | OV1, PW1 | Verified | .mcp.playwright.json |
| H9 | github-mcp-server pinned by digest `sha256:e3816a47…` via docker stdio | OV1 | Verified | .mcp.github.ro.json / .rw.json |
| H10 | "39–79 tools depending on GITHUB_TOOLSETS" | OV1 | Unverifiable (39 verified) | The rw init event in issue-create-n5 lists 39 `mcp__github__*` tools. No artifact shows 79 |
| H11 | Always-blocked: WebFetch, WebSearch, Monitor, CronCreate, RemoteTrigger | OV1, PW1 | Verified | github.ts:8, playwright.ts:4, metrics.ts:97 |
| H12 | "Blocking all five makes the trial's surface exactly the tools the arm … was supposed to have" | OV1 | Wrong | Init events show CronDelete/CronList, Task*, Edit, NotebookEdit, EnterWorktree and others still available. `--allowed-tools` does not restrict under bypassPermissions |
| H13 | "--allowed-tools … A tool must be on the allow-list AND not on the deny-list. Strict for built-in tools" | OV1 | Wrong | Only `--disallowed-tools` removed tools. Built-ins missing from the allow-list (Read, Glob, Grep, Edit…) are in every init `tools` list |
| H14 | `--setting-sources project,local`, `--permission-mode bypassPermissions` | all | Verified | COMMON_FLAGS github.ts:9, playwright.ts:5 |
| H15 | `--strict-mcp-config`, `--mcp-config`; baseline+skill use `'{"mcpServers":{}}'`; mcp points at .mcp.playwright.json / .mcp.github.{ro,rw}.json | OV1 | Verified | runner.ts:49-58; github.ts:172,179; playwright.ts:43,65 |
| H16 | Allow/deny lists are space-separated | OV1 | Verified | runner.ts:66,70 |
| H17 | `--model claude-sonnet-4-6`, overridable via `--model` | OV1, GH1, PW1 | Verified | runner.ts:141, cli.ts:42 |
| H18 | `--output-format stream-json` | OV1 | Verified | runner.ts:55. The flag table leaves out `--verbose`, which the runner also adds (runner.ts:62) |
| H19 | Fresh tempdir `os.tmpdir()/clivsmcp-<exp>-<arm>-<task>-…` | OV1 | Verified | runner.ts:156 |
| H20 | Skill bundle copied into tempdir for skill arm | OV1 | Verified | runner.ts:126-131,158 |
| H21 | "Computes a paired seed via FNV-1a from (experiment, runName, taskId, trialN)" | OV1 | Wrong | The seed is SHA-256 of `exp:run:task:n`, truncated to 16 hex (trialState.ts:46-51). FNV-1a only seeds the per-task PRNG (trialState.ts:3-25) |
| H22 | Seed hash excludes arm name | OV1 | Verified | trialState.ts:48 |
| H23 | 240 s per-trial wall budget / "Kills the child after 240 seconds" | all | Verified | runner.ts:191 `TRIAL_TIMEOUT_MS = 240_000` |
| H24 | "The 240 s TRIAL_TIMEOUT_MS cap fires against this clock [wallClockMs = result.duration_ms]" | OV1 | Wrong | The timeout is execa's wall clock in the harness (runner.ts:198). A timed-out trial has no `result` event, so wallClockMs = 0 (metrics.ts:241) |
| H25 | wallClockMs from `result.duration_ms`; totalCostUsd from `result.total_cost_usd` | OV1 | Verified | metrics.ts:241-242 |
| H26 | contextWindowPeak = running max of input+cached+cache_creation over assistant turns | OV1 | Verified | metrics.ts:197-204 |
| H27 | Tokens split into 4 buckets; report sums all four | OV1 | Verified | metrics.ts:244-251. pw-n5.md columns |
| H28 | "turns — How many agent/tool loops the workflow needed" | OV2 (also implied by all turn tables) | Wrong (definition) | `turns` counts every `assistant` stream event (one per content block: thinking, text, tool_use; metrics.ts:192-195). Example record: turns 10 vs Claude's `num_turns` 6. Turn figures are inflated relative to API round-trips |
| H29 | Result JSON schema (experiment…seed; metrics fields; success {pass,score,notes,extras}; error?) | OV1 | Verified | runner.ts:12-24, metrics.ts:14-41 |
| H30 | Example record = n5 skill tier1_repo_inventory trial 1 (all quoted values) | OV1 | Verified | experiments/github/runs/n5/results/skill/tier1_repo_inventory/1.json matches. The page drops `numTurns: 6`, which is still in the file. totalCostUsd 0.0988 ≈ 0.09885 |
| H31 | "`error` field only appears on timeout or process failure" | OV1 | Verified | runner.ts:205-211,268 |
| H32 | Results path `runs/<run>/results/<arm>/<task>/<n>.json` | OV1 | Verified | runner.ts:148,271 |
| H33 | Classifier mcp arm: "only Write, TodoWrite, ToolSearch, and the intended mcp__<prefix>__* set are valid" | OV1 | Wrong | metrics.ts:122-128 rejects only Bash/Skill/Task/Agent plus the always-blocked five. Read/Glob/Grep/ReadMcpResourceTool and any other mcp tool count as valid |
| H34 | Classifier skill arm: Skill must match intendedSkillName; Bash → classifyShellCommand | OV1 | Verified | metrics.ts:135-151 |
| H35 | Baseline: "any execution or fetch tool is a violation" | OV1 | Verified (approx.) | metrics.ts:114-119 (Bash/Skill/Task/Agent/intended MCP plus always-blocked) |
| H36 | Phase 1 split on `;`, `&&`, `||`, `\|` outside quotes; `harness/src/shell.ts:splitTopLevelShellSegments`; 4 examples | OV1 | Verified | shell.ts:6-62. classify-check.ts: `gh issue list --title "a; b"` → 1 segment |
| H37 | Phase 2 strips redirections (`>`,`>>`,`<`,`2>&1`) then checks binary prefix | OV1 | Verified | shell.ts:64-69, github.ts:48-50. classify-check: `gh … > out.json` and `gh … 2>&1` give surfaceReason null and granularity set |
| H38 | `NEW_CONTENT='...' gh api ...` ✗; `base64 -d` second segment ✗ | OV1 | Verified | classify-check output |
| H39 | Phase 3: backtick/`$(` anywhere in segment rejected | OV1 | Verified | github.ts:52, playwright.ts:12; `gh api -F "content=$(cat file)"` → command substitution |
| H40 | GitHub helper regex `(?:^|\s)(curl|…|git)\b` | OV1 | Verified | github.ts:13 |
| H41 | "the Playwright version is similar (without git). The whitespace anchor stops helper names from matching inside flag values" | OV1 | Wrong (Playwright half) | playwright.ts:7 uses `\b(...)\b` with no whitespace anchor. classify-check: `playwright-cli eval "document.cat"` and `playwright-cli open http://x/head` are flagged off-surface |
| H42 | granularityReason set on >1 segment or any redirection; doesn't fail trial in practical mode | OV1 | Verified | shell.ts:71-73, github.ts:94-97, metrics.ts:226-234 |
| H43 | research-single via `--single-cli-command`; "report flag chooses which view" | OV1 | Verified (with note) | cli.ts:137 (report). cli.ts:43 also has a *run* flag that changes the prompt (runner.ts:181-183) |
| H44 | `--include-cost` report flag | OV1 | Verified | cli.ts:138 |
| H45 | Fixture server `harness/src/fixtureServer.ts` binds 127.0.0.1:<random> | PW1, OV1 | Verified | fixtureServer.ts:127 `listen(0,'127.0.0.1')` |
| H46 | Runner "scrubs GitHub-related env vars" and later added GITHUB_CONTROLLER_TOKEN / GITHUB_AGENT_TOKEN | OV1, GH1 | Verified | runner.ts:83-108 |
| H47 | Env-scrub fix is "commit ef3fc97" | OV1 (×2), GH1 (×2) | Wrong | ef3fc97 doesn't exist. The fix is 90d0dd7 |
| H48 | Provisioner branch-ref race "fixed in 64f9436" | GH1 | Wrong | 64f9436 doesn't exist. The fix is e836d26 |
| H49 | Race fix: "6×500 ms retry loop on 404 … in experiments/github/tasks/tier1.ts" | GH1 | Verified | tier1.ts:324-341 |
| H50 | Pre-fix run preserved in `pr-diff-retry.log` | GH1 | Verified | experiments/github/runs/n5/pr-diff-retry.log |
| H51 | "the only surviving GH_*/GITHUB_* variable is now GITHUB_SANDBOX_OWNER" | GH1 | Wrong | buildChildEnv sets GH_NO_UPDATE_NOTIFIER, GH_PROMPT_DISABLED and GH_PAGER (runner.ts:116-118). Skill also gets GH_TOKEN+GITHUB_TOKEN, mcp gets GITHUB_PERSONAL_ACCESS_TOKEN (+GITHUB_TOOLSETS) |
| H52 | "env-scrub fix … closed the specific gap" / behaviourally re-verified | OV1, GH1 | Wrong (in effect) | The post-fix trial env-fix-verify/skill/tier1_issue_triage/1 still passed by running `GITHUB_TOKEN="" GH_TOKEN="" gh api …/issues`. That makes gh fall back to the developer's stored keyring login (`chief-builder`). n5 trials 2 and 4 escalated the same way. The scrub doesn't touch the keyring |
| H53 | Agent token injected as GH_TOKEN (skill) / GITHUB_PERSONAL_ACCESS_TOKEN (mcp); agent "sees GH_TOKEN only" | GH1 | Wrong (partially) | github.ts:216-227: skill gets GH_TOKEN **and** GITHUB_TOKEN. mcp gets GITHUB_PERSONAL_ACCESS_TOKEN. The diagram's "sees GH_TOKEN only" is wrong for both arms |
| H54 | Repo names `clivsmcp-<task>-<seed8>` | GH1 | Verified | provisioner.ts:229-231 |
| H55 | MCP read-only for Tier 1 (`.mcp.github.ro.json`, `--read-only`); Tier 2 rw without it | GH1 | Verified | .mcp.github.*.json; github.ts:172 |
| H56 | Tier 2 selected via `--experiment github-rw` | GH1 | Verified | experiments/index.ts:10, github.ts:256 |
| H57 | Fine-grained PAT scopes (read-only Tier 1; Issues/PR/Contents write Tier 2) | GH1 | Unverifiable | Not in repo. Transcripts show the n5 agent PAT had **no Issues read** (403 "Resource not accessible by personal access token") |
| H58 | "Plugin-bundled skills can still appear … (--setting-sources drops user-level skills but not plugin ones)" | PW1 | Wrong (cause) | Init events show `"plugins": []`. The remaining skills (update-config, debug, simplify, batch, loop, schedule, claude-api…) are Claude Code built-ins |
| H59 | Tempdir reach: agent "could in principle walk /Users/..." | PW1 | Verified (understated) | It happened. GitHub n5 baseline tier1_pr_diff_answer/3 Read `~/.config/gh/hosts.yml`, `experiments/github/provisioner.ts` and other trials' result JSON. Playwright baseline tier2_recovery 3–5 also Read project files |
| H60 | 90 Playwright n5 trials; "50+ GitHub trials across multiple runs" | OV1 | Verified | 90 PW n5; GitHub N=5 runs total 100 |
| H61 | GitHub REST list-after-write retry in successCheck | OV1, GH1 | Verified | tier2.ts:449-462 (6 attempts × 500 ms) |
| H62 | workflow_status provisioner waits for Actions run completion | OV1 | Verified | tier1.ts:500-532 (polls up to 90 s, 3 s interval) |
| H63 | "tier1_workflow_status trials wait ~10 s for GitHub Actions … — a high wallClockMs with low cost" | OV1 | Wrong | The wait is in `task.setup`, before `claude` spawns, so it isn't in wallClockMs (which page itself says excludes setup) |
| H64 | Skill paths `.claude/skills/playwright-cli/SKILL.md`, `.claude/skills/github-cli/SKILL.md` | OV1, PW1 | Verified | files exist |
| H65 | Quick-start commands (`pnpm harness verify-arms/run/report --all-tiers --crossover-analysis --output`) | OV1 | Verified | cli.ts:135-139,247 |

#### 2. Cross-experiment synthesis (OV1, OV2)

| # | Claim | Page(s) | Status | Evidence |
|---|---|---|---|---|
| X1 | "N=5 per task. Two domains" | OV2 | Verified | agg.mjs |
| X2 | Baseline "0/30 in Playwright, 0/25 in GitHub"; "0 of 55 trials" | OV1 | Verified | agg.mjs: PW n5 baseline 30/30 fail; GH n5 (15) + tier2-n5 (10) all fail |
| X3 | Clean-ratio table: login 1.42, scrape 1.33, form 2.51, products 1.41, checkout 1.29, pr_diff 1.32, workflow 1.13, issue_workflow 1.38, issue_create 1.31 (with token values) | OV1, OV2 (bars), GH1 | Verified | agg.mjs values match exactly. v2 bar widths match tokens/304,195 and /106,912 |
| X4 | "9 cross-domain comparisons … 8 of 9 land in 1.13×–1.42×" | OV1, GH1 | Verified | 5 PW + 4 GH clean. Only form (2.51) is outside |
| X5 | "Turn counts on every row above are within ±2 across arms" / "turn counts are nearly the same" | OV1, OV2 | Wrong | form 19.4 vs 13.8 (Δ5.6), checkout 20.4 vs 27.0 (Δ6.6), login 14.6/17.4, scrape 8.6/11.0, products 18.4/21.2 (Δ2.4–2.8) |
| X6 | "MCP averages 1.3×–1.4× cheaper" (Playwright card) | OV1 | Verified (approx.) | 1.29–1.42 on 4 of 5 clean tasks |
| X7 | "Seven tasks across two tiers. On the 4 clean comparisons … 1.13×–1.38×" | OV1 | Verified | 4 T1 + 3 T2 GitHub tasks; ratios per fact 2 |
| X8 | "skill arm scored 15/15 on raw success but the classifier rejected 10" | OV1, GH1, GH2 | Verified | n5 Tier 1 skill: 15 pass, 5 valid |
| X9 | "15 of 25 skill trials produced correct results by stepping off-surface" (5 tasks) | OV1, OV2 | Verified | repo_inventory, issue_triage, file_patch_pr: 0/5 valid each, all pass |
| X10 | "Skill arm scored 15/25 in surface (10 trials succeeded by escaping…)" | OV1 (Finding 5) | Wrong | Reversed: 10/25 in surface, 15/25 escaped |
| X11 | "MCP arm scored 20/25 in surface with zero off-surface calls" | OV1 | Wrong (mislabelled) | MCP validToolSurface is 25/25. 20/25 is the pass count |
| X12 | "Skill arm scored 25/25 … MCP 20/25 (issue_triage 0/5)" (success-only view) | OV1 | Verified | agg.mjs |
| X13 | "skill … scored 15 of 35 trials off-surface" / "35/35 raw, flagged 15 of 35" | OV1, PW1 | Verified | 7 GitHub tasks × 5 skill trials (directed run excluded): 35 pass, 15 invalid |
| X14 | "one trial … tried to lift the controller's elevated token" / "one attempted token-lift" | OV1, OV2, GH1, GH2 ("Env probe plus token-lift attempt") | Wrong | n5 skill tier1_issue_triage trials **1, 3 and 5** all used `$GITHUB_CONTROLLER_TOKEN` (1 and 3 via `GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api`, 5 via `curl -H "Authorization: token ${GITHUB_CONTROLLER_TOKEN}"`). Trials 2 and 4 used the developer's keyring gh token (`gh auth token`, `GH_TOKEN="" gh api`) |
| X15 | "No escalation actually happened … re-exec hit downstream classifier and gh-state failures" / "didn't succeed for unrelated reasons" | OV1, GH1 | Wrong | ctl.mjs: each controller-token call returned the full issue list including the target MARKER, and the trials passed. The agent PAT got 403 on issues, so **all 5 skill passes on issue_triage came from escalated credentials** |
| X16 | Finding 3 / issue_triage MCP: "fanned out across list_issues / search_issues / get_issue … never converging"; "This isn't an absence of capability" | OV1, OV2, GH1, GH2 | Wrong | All 5 mcp transcripts show `list_issues`/`issue_read`/`search_issues` returning 403 "Resource not accessible by personal access token" (5–29 such results per trial). The agent token couldn't read issues, so this is a credential failure, not a tool-surface one. Tool names are also wrong: the server has `issue_read`, not `get_issue`, and no `list_repository_topics` |
| X17 | MCP issue_triage "75+ turns" / "75–78 turns each" | OV1, OV2, GH1, GH2 | Wrong | turns 58, 75, 76, 78, 77 (n5/results/mcp/tier1_issue_triage) |
| X18 | MCP issue_triage 0/5, 240 s timeout | all | Verified | 5/5 `error` timeout |
| X19 | "MCP collapses to 0/5 on label-filtered issue search" | OV1 | Wrong (cause) | See X16. Smoke-n1 (different token) passed in 8 turns |
| X20 | Workflow status before Actions: 1/1, 60 turns, 169.7 s; "11 ToolSearch + 8 ReadMcpResourceTool probes" | OV1, OV2, GH2, GH1 (170 s/60) | Unverifiable | No result or transcript for that run is committed. workflow-n5/findings.md:48 has only prose ("170 s / 60 turns", "8 ReadMcpResourceTool / ListMcpResourcesTool"). "169.7" appears nowhere outside docs |
| X21 | After Actions: 5/5, 8.0 turns, 15.4 s, one actions_list | OV1, OV2, GH2 | Verified | workflow-n5 mcp: turns 8×5, 15.4 s, 1 actions_list each |
| X22 | "Compare workflow-smoke/log.txt against workflow-n5/log.txt" for the 60-turn failure | OV1 | Wrong | workflow-smoke/log.txt shows mcp `turns=8 time=15.3s` (already post-fix). The failing smoke isn't preserved |
| X23 | Directed: pass 5/5→3/5, valid 0/5→2/5, turns ~13→~30, tokens ~144k→~353k, wall ~35→~108 s | OV1, OV2, GH1, GH2 | Verified (but see X24) | agg.mjs: passing-trial avgs 30.3 turns, 353,047 tok, 108.0 s. Undirected 13.2 / 143,875 / 35.4 s |
| X24 | Directed "passing" averages describe the in-surface path | OV1, OV2, GH1 | Wrong (selection) | 2 of the 3 passing trials (2 and 4) were **invalid** (base64 -d). Only trial 1 passed and stayed valid. Across all 5 trials avg tokens = 211,828 (1.47×) because the 2 timeouts record 0 |
| X25 | "directed prompt halves the escape rate (0/5 → 2/5 valid)" | OV1 | Wrong | Escapes went from 5/5 to 3/5 (−40%), not halved |
| X26 | "The trials that did follow the directed path paid a 2.3×–3.1× cost penalty" / "The 2 that didn't [escape] paid a 2–3× cost penalty" | OV1, GH1 | Wrong | Of the 2 valid trials, #1 passed (32 turns, 120 s) and #5 timed out with 0 recorded tokens, so there's one data point. 2.3×/3.1× are turn/wall ratios over 3 passers, 2 of them invalid |
| X27 | "the two trials that failed adopted the new pattern on the write side but reverted to base64 -d" | OV1 | Wrong | The 2 failed (timed-out) trials are #3 (base64 -d) and #5 (valid, no base64). base64 -d appears in trials 2, 3 and 4 |
| X28 | "Both of the INVALID directed trials … reverted to base64 -d" | GH1 | Wrong | There are 3 invalid directed trials (2, 3, 4), all with base64 -d |
| X29 | "prompt-rewrite ceiling at 3-of-5 escapes"; "3 of 5 trials still escaped" | OV1, GH1 | Verified | valid 2/5 |
| X30 | Directed: "Two of the five trials hit the 240-second wall" | GH1 | Verified | trials 3, 5 timed out |
| X31 | "in-surface skill path … costs ~3× more" | GH1 | Wrong (number) | 353,047/143,875 = 2.45× on passers. The only valid passer (#1) used 14 tool calls / 120 s |
| X32 | tier2_file_patch_pr skill: "All 5 trials: NEW_CONTENT='...' shell variable assignment" as the escape | OV1, GH1, OV2 | Wrong (incomplete) | All 5 trials *also* escaped on the read side with `… \| base64 -d` (stored escapeToolCalls). 3 of 5 used `NEW_CONTENT=$(printf …)`, which is command substitution, not `'...'` |
| X33 | MCP file_patch_pr via create_branch + create_or_update_file + create_pull_request, 5/5 valid | OV1, OV2, GH1 | Verified | tier2-n5 mcp sequences: ToolSearch, get_file_contents, create_branch, create_or_update_file, create_pull_request (get_me in 2 trials) |
| X34 | tier1_pr_diff_answer skill uses `gh pr diff --patch` + `gh api …/pulls/N/files`, 5/5 in-surface, 1.32× | OV1, GH1 | Verified (counts) | agg.mjs. Command text not separately re-checked |
| X35 | tier2_issue_create: "one gh issue create --title --body --label --label", 5/5, 1.31× | OV1 | Verified | agg.mjs. tier2.ts:360 comment |
| X36 | "github-mcp-server uses combined actions_list / actions_get / issue_write" | OV1 | Verified | init tool lists. mcp issue_create/workflow call `issue_write` |
| X37 | "reflected in the allow-list in harness/src/experiments/github.ts" | OV1 | Wrong | Allow-list still has guessed names `create_issue`, `update_issue`, `create_release`, `get_issue`, and no `issue_write`/`issue_read`/`label_write` (github.ts:112-166). Only the actions_* names were fixed |
| X38 | Releases read-only: only list_releases, get_latest_release, get_release_by_tag; no create_release | OV1, GH1 | Verified (default toolsets) | rw init event lists exactly those 3. tier2.ts:364-367. The "under GITHUB_TOOLSETS=all, 79 tools" part is Unverifiable |
| X39 | "label_write requires toolsets=all" | OV1, GH1 | Unverifiable | No probe artifact. `get_label` only, in default init |
| X40 | Token ratio headline "1.13x-1.42x" / "skill often costs about 1.1x-1.4x MCP" | OV2 | Verified | X3 (form excluded as outlier) |
| X41 | "60 -> 8 MCP workflow-status turns" | OV2 | Unverifiable (60) / Verified (8) | see X20/X21 |
| X42 | "Widths normalized to … Playwright checkout at 304,195 skill tokens" | OV2 | Verified | inline widths match |
| X43 | Caveat: "MCP 1.13×–1.42× cheaper across 8 of 9 clean comparisons" | OV1 | Verified | X4 |
| X44 | "Every aggregate number … traces back to JSON files of this shape" | OV1 | Wrong | The 60-turn / 169.7 s workflow-status numbers (X20) have no JSON. Tool-sequence and failure-cause claims came from transcripts and are contradicted (X16) |

#### 3. GitHub pages (GH1, GH2)

| # | Claim | Page(s) | Status | Evidence |
|---|---|---|---|---|
| G1 | "N=5 · 3 Tier 1 + 2 Tier 2 tasks" | GH1 header | Wrong (stale) | The page later reports 4 T1 (with workflow_status) + 3 T2 (with issue_create) |
| G2 | Per-task Tier 1 table: baseline 0/5 ×3; skill raw 5/5 ×3; skill valid 0,0,5; mcp 5,0,5 | GH1 | Verified | agg.mjs n5 |
| G3 | Tier 1 cost table: 85,833/11.4/16.4 s vs 139,268/22.6/52.8 s; 300,429/23.4/56.8 s vs timeout; 73,146/8.0/13.9 s vs 55,534/8.2/14.1 s | GH1 | Verified | agg.mjs |
| G4 | repo_inventory skill 0.62× MCP; pr_diff 0.76× | GH1 | Verified | 85,833/139,268 = 0.616; 55,534/73,146 = 0.759 |
| G5 | repo_inventory: "MCP needs separate calls for description, topics, default branch, and README" | GH1 | Wrong (partially) | mcp trial 4 did it in `search_repositories` + `get_file_contents`. The extra MCP cost is mostly 18 ToolSearch + 7 ReadMcpResourceTool + 9 search_repositories probes across trials |
| G6 | repo_inventory skill: every trial `gh api … --jq '.content' \| base64 -d` | OV1, GH1, GH2 | Verified | escapeToolCalls in all 5 |
| G7 | issue_triage escape patterns: "`gh repo view ... 2>&1` (shell redirection)" | GH1 | Wrong (vs current classifier) | It was flagged by the pre-f73b1ca classifier ("shell redirection:" reasons in stored JSON). The current classifier treats `gh … 2>&1` as valid (classify-check). It also contradicts OV1's Phase 2 description |
| G8 | "`gh api graphql -f query=POST` (implicit write under a read-only allow-list)" | GH1 | Wrong (misleading) | The flagged calls were read-only GraphQL `query { … }` / `{ viewer { login } }`. isGhApiWrite treats any `-f` without explicit GET as POST (github.ts:39-44). That's a classifier false positive, not an attempted write |
| G9 | env-grep trial: `env \| grep -i github` then `GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api repos/.../issues` | OV1, GH1 | Verified (trial 1) | n5 skill tier1_issue_triage/1 t14, t17. Path `transcripts/skill/tier1_issue_triage/1.jsonl` is correct. Values are redacted in committed transcripts |
| G10 | "env response … included GITHUB_CONTROLLER_TOKEN=<value> … scrub list covered standard names but not the two harness-internal names" | OV1, GH1 | Verified | transcript 1/3/5 tool_result shows both names (values redacted). 90d0dd7 added them |
| G11 | "This was discovered post-n5 while writing up the findings" | GH1 | Unverifiable | — |
| G12 | Skill solved issue_triage "in ~23 turns and 57 s using a single `gh issue list --label "bug,priority-high" --json`" | GH1 | Wrong | Turns 23.4 / 56.8 s are correct, but no trial used `--label`. Each trial's only `gh issue list` failed with 403. All passes came via the controller token or the developer's keyring token (X14/X15) |
| G13 | "smoke run at N=1 had MCP passing issue_triage at 8 turns in 17 seconds" | GH1, OV1 | Verified | smoke-n1 mcp: 8 turns, 17.7 s, pass |
| G14 | "The agent's path is bimodal … All five n5 seeds landed on the bad branch" | GH1 | Wrong | All five got 403s on every issue endpoint (X16). The smoke vs n5 difference is the token's permissions |
| G15 | "Tier 1: 15/15 skill, 10/15 mcp; Skill 5/15 clean; MCP 10/15 clean, all in surface" | GH1 | Verified | agg.mjs (MCP valid is 15/15 including the timeouts) |
| G16 | "skill solves it (off-surface) at 300k tokens / 23 turns" | GH1 | Verified | 300,429 / 23.4 |
| G17 | Tier 2 table: issue_workflow 0/5, 5/5, 5/5, 5/5; file_patch_pr 0/5, 5/5, 0/5, 5/5 | GH1 | Verified | tier2-n5 |
| G18 | issue_workflow uses gh issue edit --add-label / comment / close; all 5 in surface | GH1 | Verified (validity) | 5/5 valid, singleCli 5/5 |
| G19 | Tier 2 cost: 106,912/10.6 vs 77,645/12.4 (1.38×); 143,875/13.2 vs 90,436/12.8 (1.59×) | GH1 | Verified | agg.mjs |
| G20 | MCP file_patch_pr "~13 turns, 29 s"; Skill "~13 turns, 35 s" | GH1 | Verified | 12.8 / 28.8 s; 13.2 / 35.4 s |
| G21 | Skill file_patch_pr 7-step sequence with only step 5 INVALID | GH1, OV2 | Wrong (incomplete) | Step 2 (read file) was `… \| base64 -d` and flagged in all 5 trials. Steps "write file on branch -X PUT" ran in the same Bash call as NEW_CONTENT in sampled trial 2 |
| G22 | "None recovered to a valid-surface path" | GH1 | Verified | 0/5 valid |
| G23 | "Six GitHub tasks ran … That leaves three tasks where both arms succeeded" | GH1 | Wrong | 7 tasks, and the table directly below lists 4 clean tasks |
| G24 | Clean table: pr_diff 8.0/73,146/8.2/55,534; issue_workflow 10.6/106,912/12.4/77,645; issue_create 5.2/53,760/5.8/41,169; workflow_status 8.8/76,880/8.0/67,881 | GH1 | Verified | agg.mjs |
| G25 | "Turn counts are within two of each other" (GitHub clean) | GH1 | Verified | max Δ 1.8 (issue_workflow) |
| G26 | "same pattern … every clean Playwright task (1.29×–1.42× on five of six tasks, 2.51× on the form-fill task)" | GH1 | Wrong | Only 5 Playwright tasks are clean. 4 of them are in 1.29–1.42. recovery has no clean comparison |
| G27 | "skill's 86k tokens"; "skill's 144k tokens" | GH1 | Verified | 85,833; 143,875 |
| G28 | "Four clean tasks at N=5 each (20 cross-arm data points)" | GH1 | Verified | 4 × 5 paired trials |
| G29 | Release probe "GITHUB_TOOLSETS=all returned 79 tools, of which only three relate to releases" | GH1 | Unverifiable (79) | Release-tool trio verified in default rw init (X38) |
| G30 | Directed prompt block (quoted) | GH1 | Wrong (abridged) | The real prompt (tier2.ts:343-348) explicitly lists `base64` as forbidden. The page leaves that out and then says the prompt "didn't name the equivalent for reading", which hides that the agent ignored an explicit ban |
| G31 | Directed compliant path: "Seven Write calls, fifteen tool calls total, ~30 turns" | GH1 | Wrong | The only pass+valid trial (#1) had 3 Writes / 14 tool calls / 32 turns and opened the PR with `gh pr create`. The 7-Write, `pulls --input` sequence matches trial #4 (17 calls), which was invalid (base64 -d) |
| G32 | "MCP arm achieved 5/5 valid at ~13 turns / ~90 k tokens" | GH1 | Verified | 12.8 / 90,436 |
| G33 | "Two MCP trials on tier1_pr_diff_answer threw a 404 during setup" | GH1 | Verified | e836d26 commit msg "Hit 2/5 trials in n5". pr-diff-retry.log |
| G34 | "Both PATs in the n5 run authenticated as chief-builder, scoped to chief-builder-lab" | GH1 | Verified (agent) / Unverifiable (controller) | `gh auth status` → "Logged in … account chief-builder (GH_TOKEN)". mcp `get_me` → chief-builder. Repos under chief-builder-lab |
| G35 | "Smoke had distinct identities" | GH1 | Unverifiable | — |
| G36 | "the controller PAT couldn't reach repos outside the sandbox owner" | GH1 | Unverifiable | — |
| G37 | tier2_pr_review deferred (author can't APPROVE own PR) | GH1 | Unverifiable (GitHub behaviour) | — |
| G38 | Task setups: repo_inventory 3 topics + README marker; issue_triage 5 issues, 1 target, 4 decoys, labels bug/priority-high; pr_diff src/widget.ts | GH1 | Verified | tier1.ts:66,162-199,281 |
| G39 | GH2 headline "15/15 raw", "0/5 valid" ×3, "0/5 MCP issue triage", "1.13x-1.38x" | GH2 | Verified (numbers) | agg.mjs. Causal framing wrong per X16 |
| G40 | GH2 bar widths normalized to 106,912 | GH2 | Verified | inline widths 68/52, 72/64, 100/73, 50/39 |
| G41 | "MCP stays contained" / "Typed tools stay inside the intended surface" | GH2 | Wrong (partially) | mcp trials used Read/Glob/Grep and non-allow-listed tools (H6). The classifier just doesn't flag them |

#### 4. Playwright pages (PW1, PW2)

| # | Claim | Page(s) | Status | Evidence |
|---|---|---|---|---|
| P1 | 6 tasks / 2 tiers / 3 arms / N=5 | PW1, PW2 | Verified | agg.mjs |
| P2 | Tier 1 per-task table (pass, tokens, turns, times) | PW1, PW2 | Verified | agg.mjs and pw-n5.md match all 32 values |
| P3 | Tier 2: checkout 5/5, 5/5, 304,195/236,548, 20.4/27.0; recovery 5/5 vs 2/5, 300,059, 22.4, "3 timeouts" | PW1, PW2 | Verified | agg.mjs |
| P4 | Per-tier T1: 218,012 / 132,996 / 1.64× / 15.3 / 15.8 | PW1, PW2 | Verified | pw-n5.md (no T1 timeouts in skill/mcp) |
| P5 | Per-tier T2: 302,127 / 150,630 / **2.01×** / 21.4 / 19.4 | PW1, PW2 | Wrong (biased) | MCP 150,630 averages in three 0-token timeouts (recovery mcp avg 64,713). On non-timeout trials MCP T2 ≈ 199,165, giving **1.52×**. The MCP 19.4 turns also includes timed-out trials |
| P6 | "Per-tier summary (valid trials only)" | PW1 | Verified (label) / misleading | Timeouts count as "valid surface", so they're included |
| P7 | "20/20 Tier 1 success for both"; "10/10 Tier 2 skill"; "7/10 Tier 2 MCP" | PW2 | Verified | agg.mjs |
| P8 | "Baseline was 0/20 on Tier 1 and 0/10 on Tier 2 … every trial hits the wall" | PW1 | Wrong (second half) | 0/20 and 0/10 are right, but 3 tier1_login baseline trials finished without timing out (17/20 T1 and 10/10 T2 timed out) |
| P9 | "In the skill arm, every browser action is two tool calls — the action, then an explicit `playwright-cli snapshot`" | PW1, PW2 ("Skill loop") | Wrong | skill tier1_form ×5: 25 fill + 5 click + 5 select + 5 open but only 8 snapshot calls. `click`/`select` output already includes a snapshot section (transcript form/1) |
| P10 | "@playwright/mcp bundles a post-action accessibility snapshot inline … Half the round-trip cost" | PW1, PW2 | Wrong (as the explanation for form) | mcp form ×5 made 10 explicit `browser_snapshot` calls (more than skill's 8). In mcp recovery/2, `browser_fill_form` output had no snapshot. The form gap comes from 25 per-field `fill` calls vs 5 batched `browser_fill_form` |
| P11 | tier1_form "2.5× ratio despite both arms passing 5/5 at similar turn counts"; "repeated action → check cycles" | PW1 | Wrong | Turns 19.4 vs 13.8 (+41%). The skill transcript shows consecutive `fill` calls with no check between them |
| P12 | tier1_scrape ratio "compresses to 1.33×" | PW1 | Verified | 1.328 |
| P13 | Smoke N=1 at 180 s "killed both skill Tier 2 trials at the wall" | PW1 | Verified | smoke-n1 skill tier2_checkout/recovery `timed out after 180000ms` (recovery still passed) |
| P14 | "At 240 s the skill arm finishes 10/10 cleanly, averaging 44–53 s per trial" | PW1 | Verified | 44.1 s / 53.1 s |
| P15 | MCP recovery: the 3 failures stalled "after browser_navigate → browser_snapshot → browser_fill_form (3–4 tool calls)" | PW1 | Wrong (1 of 3) | Trials 2 and 3 match (4 calls). Trial 4 stopped after a single ToolSearch (1 call, 3 turns) |
| P16 | "most likely a snapshot-driven element reference going stale" | PW1 | Unverifiable (speculation) | The transcripts just end. mcp recovery/2's last event is `system api_retry`, which points to an API/stream stall, not stale refs |
| P17 | "Typically the agent loops on a stale snapshot rather than re-fetching" | PW2 | Wrong | No looping in any failed trial: ≤4 tool calls, then silence until the 240 s kill (results mcp/tier2_recovery/2–4) |
| P18 | Passing MCP recovery trials "finished in 36 s and 34 s" | PW1 | Verified | 36.6 s, 33.9 s |
| P19 | "~60% of seeds hit it" | PW1 | Verified | 3/5 |
| P20 | "The 70% MCP success on tier2_recovery" | PW1 | Wrong | recovery is 2/5 = 40%. 70% is the Tier 2 aggregate |
| P21 | "Every Playwright trial that produced a transcript stayed in-surface" | PW1 | Verified (by classifier) | validToolSurface true for all 90 n5 trials (and the reclassification matches) |
| P22 | "Single CLI Cmd … 80% at Tier 1 and 50% at Tier 2" | PW1 | Verified | skill singleCli 16/20, 5/10 |
| P23 | Token ratio cluster "1.33×–2.51× across four tasks … other three at 1.33×–1.42×" | PW1 | Verified | 1.42/1.33/2.51/1.41 |
| P24 | "over half the skill Tier 2 trials finished in 50–70 s" | PW1 | Wrong | skill T2 walls: 40, 44, 49, 47, 39, 49, 52, 36, 66, 59 s → 3/10 in 50–70 s |
| P25 | Task descriptions: scrape 5 rows City-/Country-XXXX; form nonce per trial; products 5 pages; login PNG ≥1 KB; checkout substring marker | PW1, PW2 | Verified | trialState.ts:70-75,143; tier1.ts:115,320; tier2.ts:306-308 |
| P26 | tier2_recovery is a "Password-reset flow" | PW1 | Wrong (minor) | It's a verification-code form (tier2.ts:463-473: "Verification code: unknown"). There's no password reset |
| P27 | "storefront with multiple products" | PW1 | Verified | 3 products (trialState.ts:189) |
| P28 | "No static HTML with answers in it sits on disk" | PW1 | Verified (approx.) | Templates only. The login fixture is static index.html, but its credentials are given in the prompt anyway |
| P29 | "skill pass 5/5 … recovery 2/5 MCP" table on PW2 | PW2 | Verified | agg.mjs |
| P30 | PW2 bar widths normalized to 304,195 | PW2 | Verified | inline widths |
| P31 | "The skill arm passed 5/5 at the same wall budget" | PW2 | Verified | — |
| P32 | "showed up in smoke too at a similar shape" | PW1 | Verified | smoke-n1: login 1.27, scrape 1.49, form 2.79, products 1.77 |

---

#### (a) Internal links that don't resolve
None. Every relative `href`/`src` in the 7 HTML files resolves (cli_mcp_experiments*.html, github_experiment*.html, playwright_experiment*.html, assets/*.png ×8, and the index.html redirect). There are no `#anchor` links. v1 pages only link to v1 pages, and v2 pages link to v1 "full" pages.

Repo-path citations in page text that don't hold up:
- OV1 "Compare experiments/github/runs/workflow-smoke/log.txt against …workflow-n5/log.txt": the file exists, but it doesn't show the 60-turn run (X22).
- Commit refs `ef3fc97` (OV1 ×2, GH1 ×2) and `64f9436` (GH1) don't exist (H47, H48).

#### (b) Absolute local paths
- playwright_experiment.html:490: the literal text "/Users/..." (generic, in the tempdir caveat). No full local paths in any docs page.
- Not in docs, but related: committed transcripts contain `/Users/chiefbuilder/...` and `/var/folders/h7/...` paths (init `cwd`, `memory_paths`, Write file_path).

#### (c) Employer/company names
None that look like an employer. Names that do appear: "Anthropic" (OV1, as the vendor), "chief-builder" (GitHub user) and "chief-builder-lab" (sandbox org) in OV1:372-406 and GH1:747. These are the author's personal GitHub handle and org, not synthetic names. The project CLAUDE.md example says `cli-vs-mcp-lab`, but the data uses `chief-builder-lab`. Fixtures use "Acme" (synthetic).

#### (d) v1 ↔ v2 contradictions (and v1 internal contradictions)
1. Skill in-surface count: OV1 Finding 5 says "Skill arm scored 15/25 in surface (10 escaped)". OV2 says "15/25 … succeeded by stepping outside". OV2 is right (X10).
2. Recovery failure cause: PW1 hedges ("most likely a stale element reference"). PW2 states it as fact ("Typically the agent loops on a stale snapshot"). The data supports neither (P16/P17).
3. PW1 says "The 70% MCP success on tier2_recovery", while PW1's own table and PW2 say recovery is 2/5 (P20).
4. Directed cost penalty is given four different ways: OV1 "2.3×–3.1×", OV1 "2–3×", GH1 "~3× more", GH1/OV2 table "~353k vs ~144k (2.5×)" (X26/X31).
5. Which directed trials reverted to base64: OV1 says "the two trials that failed", GH1 says "Both of the INVALID directed trials". The data has 3 invalid trials, and only one of the two failures used base64 (X27/X28).
6. GitHub task count: GH1 header says "3 Tier 1 + 2 Tier 2", GH1 body says "Six GitHub tasks", OV1 says "Seven tasks". Clean tasks: GH1 says "leaves three tasks" and then shows a 4-row table (G1/G23).
7. Playwright clean-task band: GH1 says "1.29×–1.42× on five of six tasks". OV1 and PW1 say four tasks in band plus the form outlier (G26).
8. Redirection handling: OV1 Phase 2 says redirections are stripped and not a surface violation, but GH1 lists `gh repo view ... 2>&1 (shell redirection)` as a containment break (G7).
9. Turn parity: OV1 and OV2 say "within ±2 / nearly the same" for all clean rows. PW1's own table shows form 19.4 vs 13.8 and checkout 20.4 vs 27.0 (X5).
10. MCP in-surface for GitHub: OV1 says "20/25 in surface". GH1 says MCP "All 10 stayed in surface" and "no MCP trial escaped" (which implies 25/25) (X11).


### 2d. CLAUDE.md

| Claim | Status | Evidence |
|---|---|---|
| Structure, arm-isolation flags, "always blocked" list | Verified | As R1, R10 |
| "`--allowed-tools <list>` is a positive allow-list" | **Wrong** | As R8 |
| "The runner scrubs inherited `GH_*`/`GITHUB_*` env vars" | **Partly wrong** | It scrubs a fixed list of 17 names (`runner.ts:83-108`), not all `GH_*`/`GITHUB_*` |
| Example `GITHUB_SANDBOX_OWNER=cli-vs-mcp-lab` | Unverifiable | Transcripts show the owner actually used was `chief-builder-lab` |

---

## 3. Currency

Checked 2026-10-02 against the npm registry, `nodejs/Release` `schedule.json`, GitHub Releases, GHCR, and modelcontextprotocol.io.

| Item | In repo | Latest stable | Notes |
|---|---|---|---|
| Node.js | not pinned (no `.nvmrc` / `engines`) | 24.21.0 (Active LTS "Krypton"; maintenance from 2026-10-20). 26.x becomes LTS on 2026-10-28 | Recommend pinning 24 now and noting 26 |
| pnpm | not pinned (no `packageManager`) | 12.8.1 | Local is 11.0.9. `pnpm-workspace.yaml` `allowBuilds` duplicates `package.json` `pnpm.onlyBuiltDependencies` |
| typescript | 6.0.3 | 7.0.2 | Major. TS 7 is the native compiler port; needs a trial typecheck |
| tsx | 4.21.0 | 4.23.15 | Also fixes the esbuild advisory (see §7) if it pulls esbuild ≥ 0.28.1 |
| @types/node | 25.7.0 | 26.6.4 | Should track the pinned Node major (24) |
| commander | 14.0.3 | 15.0.0 | Major; small API surface used |
| execa | 9.6.1 | 10.0.1 | Major; uses `timeout`, `reject`, `env`, `timedOut` |
| zod | 4.4.3 | 4.6.5 | Minor |
| @playwright/cli (skill arm subject) | 0.1.13 | 0.1.22 | **Experiment subject.** Upgrading changes the measured tool and breaks comparability with committed n5 data |
| @playwright/mcp (mcp arm subject) | 0.0.75 | 0.0.83 | Same as above |
| github-mcp-server (mcp arm subject) | v1.0.4 (by digest) | v1.13.0 | Same as above |
| Claude Code (agent under test) | 2.1.142–2.1.143 recorded | 2.1.287 installed | Not pinned. The tool surface changed between these versions (new `Workflow`, `SendMessage`, `ListAgents`) |
| Model | `claude-sonnet-4-6` | Sonnet 5.5 (`claude-sonnet-5-5`) is the newest Sonnet | Experiment parameter; changing the default would change results |
| GitHub REST API version header | `2022-11-28` (`provisioner.ts:49`) | Not re-checked | Still accepted; leave unless the provisioner breaks |
| MCP specification | **No direct target** | Current revision **2026-07-28** | The harness does not implement MCP; Claude Code is the client. The negotiated version is not recorded in transcripts. Recommend documenting this and the server versions |

What upgrading would break: harness dependencies (typescript, tsx, commander, execa, zod, @types/node) do not affect
measurements. Upgrading any **experiment subject** (the two Playwright packages, github-mcp-server, Claude Code, model)
makes new runs incomparable with the committed n5 results. Those should stay pinned and documented, and be upgraded
only together with a new run.

---

## 4. Design

**Strengths.** Clean experiment registry (`ExperimentSpec` + `experiments/index.ts`). The classifier lives in each
experiment spec, not the core. Paired seeds give deterministic per-trial state. Answers are served from memory, not disk.
The env scrub is centralized. Code is small and readable.

**Correctness and measurement defects**

- **W1. Timed-out trials record 0 tokens and 0 ms.** All 70 committed timeouts have `inputTokens = cachedInputTokens = outputTokens = 0` and `wallClockMs = 0`. Totals come only from the final `result` event (`metrics.ts:239-258`), which a killed process never emits. Per-turn `usage` is available on `assistant` events and is used for `contextWindowPeak` but not summed. Effects: per-task and per-tier averages that include timeouts are biased low (R33, R44), and the "Time" column shows 0.0 s for timed-out arms.
- **W2. Tool isolation relies on `--allowed-tools`, which does not restrict tools under `bypassPermissions`** (R8). The classifiers are deny-lists, so new Claude Code tools are silently treated as in-surface (R21). The CLI now offers `--tools <list>` to set the built-in tool set positively.
- **W3. `verify-arms` does not reproduce trial conditions** (R15): it runs in the repo root and reports the model's self-description. It could read the `init` event's `tools` list from a stream-json probe in a tempdir.
- **W4. Classifier inconsistencies.** Playwright `INVALID_HELPERS_RE` uses `\b` (`playwright.ts:7`), so `playwright-cli goto http://x/cat` is flagged as a helper. GitHub uses `(?:^|\s)`. Neither lists `base64`. Redirections are stripped before the surface check, which contradicts the docs (R23).
- **W5. Cleanup is not guaranteed.** If `startFixtureServer`, a transcript write, or the `cp` of the workdir throws, `task.cleanup` never runs (`runner.ts:164-255`). For GitHub, the private sandbox repo is then leaked. `trialWorkDir` also leaks if `task.setup` throws.

**Configuration and duplication**

- Default model `'claude-sonnet-4-6'` appears in three places (`cli.ts:42,250`, `runner.ts:141`). `TRIAL_TIMEOUT_MS` is a local constant (`runner.ts:191`). `ALWAYS_BLOCKED` and `COMMON_FLAGS` are duplicated in `playwright.ts` and `github.ts`, and a third time as `ALWAYS_BLOCKED_NAMES` in `metrics.ts:97`.
- `verify-arms` picks its probe text with `experiment.name === 'github'` (`cli.ts:255`), which is per-experiment logic in the shared CLI.
- GitHub env (`GITHUB_AGENT_TOKEN`, `GITHUB_CONTROLLER_TOKEN`, `GITHUB_SANDBOX_OWNER`, `GITHUB_HOST`) is read ad hoc in `github.ts:213-245` and `provisioner.ts:17-27`, and validated only by preflight.

**Input validation and error handling**

- `--trials abc` / `--tier x` → `NaN`. The trial loop silently runs zero times (`cli.ts:41,100`).
- `--run ../../x` is joined into a filesystem path unchecked (`runner.ts:38-40`). It is a local CLI, but a name pattern should be enforced.
- `report` / `recompute-metrics` / `verify-arms` with an unknown `--experiment` crash with a stack trace (`cli.ts:154,201,253`); `run` handles it.
- Logging is unstructured `console.*`. No secrets are logged today: tokens appear only in child env, and GitHub API errors echo response bodies, not request headers.

**Dead code**

- `mkSeed` (`trialState.ts:41`): unused.
- `hasShellRedirection` (`shell.ts:75`): unused since `f73b1ca`.
- `LoadedExperiment` (`experiment.ts:68`): unused.
- `ArmConfigSchema` (`experiment.ts:14`): used only for its type.
- `RunTrialOptions.agentEnv` (`runner.ts:35`): never passed.
- `tsconfig.json` `jsx: react-jsx`, `declaration`, and `outDir`: no JSX, no build step.

**Docs duplication.** Two generations of every docs page (`*_experiment.html` and `*_v2.html`) are published, and the v2 pages link back to v1.

**Larger redesign worth considering (proposal only).** Run each trial with `--bare` or `--tools` plus an explicit
`--add-dir`, so that file tools are confined to the trial tempdir. `--bare` confines file tools to working directories,
per `claude --help`. This closes S2 at the source rather than relying on a classifier after the fact. It changes trial
conditions, so it would need a fresh run.

---

## 5. Tests

- **None exist.** There is no test runner, no `test` script, and no test files. The only automated check is `pnpm typecheck`, which passes from a clean clone (`tsc --noEmit`, exit 0).
- The most important untested paths, in order:
  1. `classifyShellCommand` for both experiments: the trust signal behind every "valid surface" number.
  2. `splitTopLevelShellSegments` / `stripSimpleRedirections`.
  3. `parseTranscript`, including the timeout (no `result` event) case (W1).
  4. `buildChildEnv` scrub: no controller token reaches the child.
  5. `buildGithubAgentEnv` per-arm token routing.
  6. `isGhApiWrite`.
  7. Fixture-server path traversal (403) and body limit (413).
  8. `report` aggregation and ratios.
  9. `mkPairedSeed` determinism.
- None of these need network, Claude, or Docker, so all can run in CI.

---

## 6. CI/CD

- **No workflows in the repo** (`.github/` does not exist).
- GitHub Pages is deployed by GitHub's built-in `pages-build-deployment` from `main:/docs` (last run succeeded 2026-05-18). It is configured in repo settings, not in a workflow file. It must keep working: keep `docs/` on `main` and keep `docs/index.html`.
- Gaps: no install / typecheck / test / lint / link check on PRs, no Dependabot, no CodeQL.

---

## 7. Security

- **S1. Tool isolation (integrity of results).** See W2 and R8. In a security framing, the "surface" the experiment advertises is wider than documented. With `bypassPermissions`, every arm also has `Edit` and `NotebookEdit` on the whole filesystem the user can write to.
- **S2. Personal data in committed transcripts (privacy, already public).** In 436 tool calls, baseline agents read or listed files outside the trial tempdir, and the tool results are committed under `experiments/*/runs/*/transcripts/baseline/`. Exposed: the `~/.gitconfig` personal email (12 occurrences), `~/.claude.json` fragments, `~/.claude/settings.json`, `~/.zshrc`/`.zshenv`, `~/.config/gh/{hosts,config}.yml`, the Claude Desktop config, and home-directory listings naming ~20 other private project folders. **No credentials were found**: `gh` tokens are in the keychain and appear only masked (`gho_****`), and `gitleaks` 8.30.1 over all 36 commits reports 0 findings. The repo also contains 1,116 absolute `/Users/chiefbuilder/...` paths, nearly all in run artifacts; non-artifact files are `README.md` and `docs/playwright_experiment.html`. History is public and will not be rewritten (per ground rules), so redacting now only removes the data from the default branch. Whether to also rewrite history is your call.
- **S3. Credential escalation through the developer's `gh` login (open).** The env scrub removes token env vars but leaves `gh`'s default config dir and OS keyring reachable. With `--permission-mode bypassPermissions` and no real Bash restriction (R8), a skill-arm agent can run `gh auth token`, or call `gh` with `GH_TOKEN=""`, and act as the developer's full-scope OAuth login (`gist, read:org, repo, workflow` per `gh auth status` in transcripts). This happened in n5 trials 2 and 4 and in `env-fix-verify`. Fix: point `GH_CONFIG_DIR` at an empty per-trial directory and leave keyring access unreachable. That needs a Bash restriction at the CLI level (`--tools` and/or a sandbox), because `Bash(gh:*)` does not constrain anything under `bypassPermissions`. Anyone running the harness as published is exposed to this.
- **No employer references found.** Checked commit authors, transcripts, docs, and the `~/.claude.json` excerpts; no `oauthAccount` or `organizationName` fields were captured.
- **Secrets handling.** `.env` is gitignored and untracked; it contains three fine-grained PATs locally. The controller token never enters the child env (`runner.ts:83-108`). The agent token is injected only for skill/mcp arms. No tokens appear in logs.
- **Dependency audit.** `pnpm audit`: 1 **low** (GHSA-g7r4-m6w7-qqqr, esbuild < 0.28.1 via tsx; affects only Windows dev servers). No high or critical.
- **Least privilege.** No workflows exist, so there are no workflow permissions to tighten. The README documents token scopes, though the controller needs Administration:write (repo delete) and Workflows:write. MCP config passes the token via `-e NAME` (value not in argv), which is good.
- **Unsafe defaults.** `bypassPermissions` is by design (non-interactive) but is not paired with a filesystem confinement (S2). The fixture server binds `127.0.0.1` (good) and returns `String(err)` on 500 (acceptable locally).
- **Licensing.** No LICENSE file. `.claude/skills/playwright-cli/` is a modified copy of the Apache-2.0 skill shipped in `@playwright/cli@0.1.13`. Apache-2.0 §4 requires keeping the license notice and marking modifications; neither is done.

---

## 8. Onboarding (README quickstart, clean clone, macOS, Node 24.15.0, pnpm 11.0.9, Claude Code 2.1.287)

| Step | Result |
|---|---|
| `git clone` + `pnpm install` | OK (510 ms) |
| `pnpm typecheck` | OK |
| `pnpm harness verify-arms --experiment playwright` | Ran (~33 s, 3 paid calls), but runs in the repo root, so the output reflects the repo's `CLAUDE.md` (W3) |
| `pnpm harness run --experiment playwright … --task tier1_scrape --trials 1` × 3 arms | skill ✓ 19.5 s, mcp ✓ 17.2 s, baseline ✗ timeout (expected) |
| `pnpm harness report …` | OK |
| `verify-arms --arm mcp` (documented) | **Fails**: `unknown option '--arm'` |
| GitHub setup "in a gitignored .env" | **Fails**: `.env` is never loaded, and preflight points to a nonexistent README section |
| Prerequisites | **Missing from README**: Node version, pnpm, Claude Code CLI installed and logged in (trials cost money), Docker (GitHub mcp arm), `gh` (GitHub skill arm), Playwright browser install on a fresh machine |
| Cost/time expectation | Not stated. A full n5 run is hundreds of paid `claude -p` calls |
| License / status | No license; no status or limitations summary up top |

---

## Prioritized plan for Phase 2

Each item becomes one or more small conventional commits on this branch.

**P0: correctness of published claims and privacy**
1. Fix every Wrong claim in README, CLAUDE.md, docs pages, and the preflight message (R6, R8, R13, R15, R19–R24, R26, R28, R31, R33, R39, R41, R44, R47, R49, and §2c items). **Numbers change only where the recomputation above supports it.** Each change will be listed in the PR for your profile and resume.
2. Fix W1 in `metrics.ts`: sum per-turn `assistant.usage` when no `result` event arrives, and mark the trial `timedOut`. Then `recompute-metrics` on committed runs; transcripts are kept, so this re-parses without re-running. Regenerate the committed findings, and update claims that move (Playwright T2 ratio, directed-prompt multiple). *Needs your OK because it changes headline numbers.*
3. Redact out-of-tempdir tool results in committed baseline transcripts (replace content with `[redacted: read outside trial dir: <~-relative path>]`) and replace `/Users/<name>/` with `~/` in all committed artifacts. *Needs your OK: it rewrites raw data files (not history).*

4a. Close S3 in the runner: per-trial empty `GH_CONFIG_DIR` (plus `XDG_CONFIG_HOME`), with a unit test that the child env has no path to the developer's `gh` login. This changes the GitHub skill arm's conditions, so it ships with a note that n5 issue-triage numbers predate it.

**P1: engineering baseline**
4. Pin Node 24 (`.nvmrc`, `engines`) and pnpm (`packageManager`). Upgrade harness deps (tsx, zod, commander, execa, @types/node@24, TypeScript 7 if typecheck passes, otherwise hold at 6 with a note). Hold experiment subjects and document them.
5. Tests with Vitest plus coverage for the nine paths in §5, positive and negative for token scrub, token routing, classifiers, and fixture-server traversal. One command: `pnpm test`.
6. Small design fixes: centralize config (default model, timeout, always-blocked list, common flags) in one module, validated at startup; validate CLI numeric args and run names; guarantee cleanup with `try/finally`; remove the dead code listed in §4; make the Playwright helper regex consistent with GitHub's and add `base64`.
7. Fix `verify-arms`: run in a tempdir, read the tool list from the `init` event, and print it alongside the model's answer.
8. CI workflow (install, ESLint, Prettier check, typecheck, test + coverage, link check with lychee), CodeQL workflow, Dependabot (npm + actions), SHA-pinned actions, `permissions: contents: read`, concurrency, timeouts, README badge.
9. README rewrite into the requested structure (summary, why, Mermaid architecture, prerequisites, quickstart, config table, tests, status and limitations, license), keeping your findings and wording wherever they are accurate.
10. Hygiene: LICENSE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, `.editorconfig`, issue and PR templates, broader `.gitignore`, Apache-2.0 attribution for the Playwright skill.

**P2: proposals I will not do without a decision**
- W2 / S1 / S2 at the source: switch arms to `--tools` (and possibly `--bare` with `--add-dir`) and extend classifiers to allow-lists. This changes trial conditions, so the committed n5 numbers would describe the old configuration until re-run.
- Retire the v1 docs pages, or label them as archived.
- Re-run n5 with current Claude Code and pinned subjects.

---

## Addendum: findings during Phase 2 (2026-10-02)

- **The env scrub never worked.** execa's `extendEnv` defaults to `true`, which merges `process.env` back into the
  child, so deleting keys from the env object had no effect. The `90d0dd7` fix therefore did not remove the controller
  token. Fixed with `extendEnv: false`; a test asserts a scrubbed variable is invisible to a real child process.
- **An empty `GH_CONFIG_DIR` alone does not stop `gh auth token`.** On macOS `gh` still reads the keychain. Claude
  Code's OS sandbox (`sandbox.enabled`, `allowUnsandboxedCommands: false`, `filesystem.denyRead: ["~/"]`) does block it.
  This was verified by running Bash commands through `claude -p` that print only AVAILABLE/BLOCKED. While testing, an
  unsandboxed probe printed the author's `gh` OAuth token into the local session log (not into the repo); the author
  was asked to rotate it.
- **`--tools` exists and works.** It restricts the built-in tool set; unknown names are ignored. Deny rules
  `Read(~/**)` / `Edit(~/**)` hold under `bypassPermissions` for Read, Glob and Grep. Verified with `verify-arms` on
  Claude Code 2.1.287: baseline `Glob Grep Read ToolSearch Write`, skill `Bash Skill ToolSearch Write`, mcp
  `ToolSearch Write` plus 23 Playwright MCP tools.
- **Re-classification of committed runs** with the allow-list classifier flipped 4 trials to invalid surface, all of
  them failed trials, so no headline pass/valid number changed.
- **Live GitHub verification is blocked.** The controller token in the local `.env` returns 401 Bad credentials, so no
  GitHub trial could be run (nothing was created).
- **TypeScript 7** passes `tsc` but typescript-eslint 8.71 refuses it, so TypeScript is held at 6.0.3.

### Live GitHub verification (after token rotation)

- New tokens checked with a non-destructive probe. The controller can create and delete repos and write workflows. The
  read-only agent token reads repo, contents, issues, PRs and Actions, and every write or admin call is refused. The
  read-write agent token can write issues, files and PRs, and admin calls are refused. All three tokens belong to the
  same user.
- **Correction to the earlier sandbox claim.** Under the sandbox, `gh` could not verify TLS on macOS
  (`x509: OSStatus -26276`, because Go CLIs need the system trust service). The earlier probe's `gh api` exit code 1
  was this failure, not a 401 as assumed. The first live skill trial fell back to `curl` and was correctly flagged
  INVALID. Fixed by setting `sandbox.enableWeakerNetworkIsolation`, the documented setting for Go CLIs on macOS. It was
  re-verified to authenticate `gh` while keeping the keychain (`gh auth token`, `security`) and `$HOME` reads blocked.
- `verify-arms --experiment github` (Claude Code 2.1.288): baseline `Glob Grep Read ToolSearch Write`; skill `Bash
  Skill ToolSearch Write`; mcp `ToolSearch Write` plus 26 tools from the read-only server.
- Trials (`experiments/github/runs/isolation-check`):

  | Task | Arm | Result |
  |---|---|---|
  | `tier1_pr_diff_answer` | baseline | fail, valid, timeout |
  | `tier1_pr_diff_answer` | skill | pass, valid, 10.3 s |
  | `tier1_pr_diff_answer` | mcp | pass, valid, 8.4 s |
  | `tier2_issue_create` (RW token) | skill | pass, valid |
  | `tier2_issue_create` (RW token) | mcp | pass, valid |

  The artifacts contain no token-shaped strings or home paths, and no sandbox repos were left behind.
- **Residual.** The baseline's file tools can still read outside `~` and the repo, e.g. `$TMPDIR` (it made 28 such
  calls). Results are redacted; full confinement needs a container.

### Re-run `n5-v2` (2026-10-03)

- 161 trials: skill and mcp at N=5, baseline at N=2, plus the directed variant (skill only, N=5). Run under the
  current isolation on Claude Code 2.1.288 with the same pinned subjects. Results are in
  `experiments/*/runs/n5-v2/findings.md`; the README, findings and docs site now lead with them, and `n5` is kept as
  history.
- Harness problems found during the run, all fixed and covered by tests:
  - The controller token lacked Actions: read, and the setup failure leaked repos (`8a6cc40`).
  - Claude Code's `__unparsedToolInput` caused 2 false escapes (`40521c2`).
  - The `issue_create` checker window was too short, causing 1 false negative, kept as recorded (`40521c2`).
  - Tier 2 needed re-classification with `github-rw` (`8d113c0`).
