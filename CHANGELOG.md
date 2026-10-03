# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-10-03

Hardening release. See `AUDIT.md` for the findings behind each change.

### Results
- New `n5-v2` run (161 trials) under the enforced isolation, now the headline in the README, findings and docs site.
  MCP passed and stayed in surface on every task; skill/MCP token ratio 1.5–2.1× (form 2.67×); the skill arm's
  `base64 -d` escapes reproduced; `tier1_issue_triage` is now a valid comparison. The May `n5` run is kept as history.

### Security
- Child env scrub now takes effect. execa had been merging the parent environment back into the agent's
  environment, so the controller token stayed visible to the agent even after the earlier `90d0dd7` change.
- Each trial gets an empty `GH_CONFIG_DIR`, and the GitHub skill arm's Bash runs in Claude Code's OS sandbox with no
  unsandboxed fallback, which closes the path to the developer's own `gh` login.
- File tools are denied under `~` and the repo; transcripts and results are redacted (home paths, out-of-trial file
  reads) before they are written. Existing run artifacts were redacted.

### Fixed
- GitHub skill arm: sandboxed `gh` could not verify TLS on macOS; `enableWeakerNetworkIsolation` is now set
  (keychain and `$HOME` stay blocked).
- A GitHub task setup that failed after creating its repo leaked the repo; setups now delete it on failure.
- Tool calls that Claude Code records as `__unparsedToolInput` are unwrapped before classification.
- `tier2_issue_create` success check waits up to ~11 s for GitHub's issue list (was 3 s; caused a false negative).
- Tool isolation: arms now pass a positive `--tools` list. `--allowed-tools` never restricted tools under
  `bypassPermissions`. The classifier is now an allow-list derived from the same list.
- Timed-out trials no longer record 0 tokens and 0 ms; tokens are summed from per-message usage and flagged as
  lower-bound estimates. Stored metrics for all committed runs were recomputed.
- Task cleanup (sandbox repo deletion) and temp-dir removal run in `finally`.
- CLI validates `--trials`, `--tier`, `--arm`, `--run`; unknown experiments no longer print a stack trace.
- Playwright classifier no longer flags helper names inside URLs or JS; both classifiers treat `base64` as a helper.

### Changed
- `recompute-metrics --tier` for runs that mix `github` and `github-rw` tasks.
- GitHub setup documents separate read-only (Tier 1) and read-write (Tier 2) agent tokens.
- `verify-arms` starts each arm exactly like a trial and prints the tool list from the `init` event; adds `--arm`.
- `.env` is loaded automatically; GitHub configuration is validated at startup.
- New `redact-artifacts` command; reports gain a Timeouts column.
- Node 24 LTS and pnpm 12 pinned; harness dependencies upgraded (TypeScript held at 6.0.3 for typescript-eslint).
- README, CLAUDE.md, findings and the docs site corrected against the data (see the PR's claims table); v1 docs
  pages removed.

### Added
- Vitest unit and integration tests, ESLint, Prettier, CI (lint, format, typecheck, tests with coverage, link check),
  CodeQL, Dependabot.
- LICENSE (MIT), NOTICE (Apache-2.0 attribution for the adapted playwright-cli skill), SECURITY.md, CONTRIBUTING.md,
  `.editorconfig`, issue and PR templates, `.env.example`.

## [1.0.0] - 2026-05-18

Initial public version: Playwright and GitHub experiments with N=5 runs and the docs site.
