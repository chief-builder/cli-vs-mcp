# Playwright Experiment Methodology

This document describes how the Playwright experiment isolates each arm so that token counts, turn counts, and success rates measure the **tool surface**, not the agent's ability to escape the sandbox.

## What we measure

Per-trial metrics captured in `experiments/playwright/runs/<run>/results/<arm>/<task>/<n>.json`:

| Metric | Source | Meaning |
|---|---|---|
| `success.pass` / `success.score` | `task.successCheck(ctx)` | Did the agent produce the expected artifact? |
| `metrics.inputTokens`, `cachedInputTokens`, `cacheCreationInputTokens`, `outputTokens` | stream-json `result.modelUsage` | Token accounting per trial |
| `metrics.turns`, `numTurns` | stream-json `assistant` count and `result.num_turns` | Conversation depth |
| `metrics.wallClockMs` | stream-json `result.duration_ms` | End-to-end latency |
| `metrics.toolCallCount` | counted from `tool_use` blocks | How many tool invocations |
| `metrics.usedIntendedTool` | `Skill(playwright-cli)` OR `mcp__playwright__*` seen | Confirms the agent stayed on the intended path at least once |
| `metrics.validToolSurface` | classifier verdict over every `tool_use` | True only if **every** call stayed in-surface |
| `metrics.singleCliCommandPerToolCall` | shell-segment parser | Research-mode flag: one `playwright-cli` per Bash call |

Token columns and wall-clock are the primary cost signals. Validity is the trustworthiness signal — a passing trial with `validToolSurface: false` means the agent succeeded by escaping the intended path (and the result should not be aggregated into the headline numbers).

## Arm isolation

The runner in `harness/src/runner.ts:runTrial` builds the claude argv from `experiment.arms[arm]` plus a small set of always-on flags:

| Flag | Why |
|---|---|
| `--strict-mcp-config --mcp-config <…>` | Pin exactly which MCP servers (and tools) the arm sees |
| `--allowed-tools <list>` | Positive allow-list — the agent literally cannot see other tools in its system prompt |
| `--disallowed-tools <list>` | Deny-list for built-ins not covered by allow-list (closes shortcuts like `Bash`, `Skill`, `Task`, `Agent`) |
| `--setting-sources project,local` | Drop the user's `~/.claude/` so user-level skills don't leak into the experiment |
| `--permission-mode bypassPermissions` | Required for non-interactive `claude -p` |

Per-arm allow/deny lists in `harness/src/experiments/playwright.ts`:

| Arm | Allowed (positive list) | Notes |
|---|---|---|
| `baseline` | `ToolSearch Read Glob Grep Write TodoWrite` | No execution channel. `Bash`, `Skill`, `Task`, `Agent` are denied. Should produce 0 successes on non-leaky tasks. |
| `skill` | `ToolSearch Skill Bash(playwright-cli:*) Write TodoWrite` | The skill is bundled at `.claude/skills/playwright-cli/SKILL.md`. `Bash(playwright-cli:*)` constrains shell to commands starting with `playwright-cli`. |
| `mcp` | `ToolSearch Write TodoWrite` plus the **enumerated** `mcp__playwright__*` tools | No `Bash`, no `Skill`. Tools enumerated rather than globbed so the allow-list survives any future glob-matcher changes. |

Always blocked across every arm: `WebFetch`, `WebSearch`, `Monitor`, `CronCreate`, `RemoteTrigger` — each is a process-execution or URL-fetch channel that an agent will use to bypass `Bash` if `Bash` is blocked.

## Fixture isolation

Playwright fixtures are HTML templates that the per-trial fixture server (`harness/src/fixtureServer.ts`) renders dynamically. Per-trial state — randomized city names, product titles, form nonces, recovery tokens — is generated from the paired seed and held in **process memory only**.

This matters because the agent has `Read` and (in some arms) `Glob` against its tempdir. A static `index.html` with the answer would be trivially readable. The dynamic-render path keeps the answer off disk.

The fixture server listens on `http://127.0.0.1:<random-port>` — the agent navigates by URL, never by file path.

## Task suite

### Tier 1 — read-only

- `tier1_login` — log in, take a screenshot, save PNG (≥1 KB).
- `tier1_scrape` — extract a 5-row table where city/country names are randomized per trial.
- `tier1_form` — fill a form; success token is revealed only on a valid POST that matches a per-trial nonce.
- `tier1_products` — visit 5 product pages, extract per-page title and price.

### Tier 2 — multi-step / mutation

- `tier2_checkout` — find the product matching a substring marker, add to cart, complete checkout.
- `tier2_recovery` — recover a password through a flow that requires reading an inline error code and re-submitting.

## Validity classifier (Playwright)

The Playwright classifier (`harness/src/experiments/playwright.ts`) encodes:

- `intendedMcpPrefix = 'mcp__playwright__'`
- `intendedSkillName = 'playwright-cli'`
- `intendedShellCommand = 'playwright-cli'`
- `classifyShellCommand(cmd)`:
  - Splits the Bash command into top-level segments (respecting quotes / `;` / `&&` / `||` / `|`).
  - Every segment must start with `playwright-cli`.
  - Segments may not contain backticks or `$(...)` command substitution.
  - Segments may not invoke helpers (`curl wget cat ls python python3 node npm npx sh bash zsh jq sed awk grep head tail`).
  - Chained segments (`&&`, `;`, etc.) are valid surface in `practical` mode but invalid in `research-single` mode (`--single-cli-command`).
  - Shell redirections are accounted for separately when checking command granularity.

## Run modes

- **practical** (default): the classifier accepts multi-segment Bash calls as long as every segment is `playwright-cli`.
- **research-single** (`--single-cli-command`): each Bash call must contain exactly one `playwright-cli` command, no chaining, no pipes, no redirections. Compares apples-to-apples turn counts because every CLI command is its own tool call.

Both modes are reportable from the same stored results — the classifier flags both `validToolSurface` and `singleCliCommandPerToolCall` per trial, and `pnpm harness report --single-cli-command` aggregates the stricter view.

## What this methodology does **not** address

- The tempdir is in the same user account as the experiment runner. `Read`/`Glob` could in principle reach project paths if the agent walks the filesystem. We accept this for v1; per-trial dynamic fixtures + `bypassPermissions` rooted in a fresh tempdir close the practical cases.
- Plugin-provided skills can still appear in the system prompt and consume tokens. `--setting-sources project,local` drops user-level skills but doesn't touch plugin-bundled ones. The system-prompt token overhead is constant per run, so cross-arm comparisons remain valid.
