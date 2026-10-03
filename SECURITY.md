# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/chief-builder/cli-vs-mcp/security/advisories/new)
("Report a vulnerability" on the Security tab). Do not open a public issue.

Include what you found, how to reproduce it, and the impact you expect. You should get an acknowledgement within
7 days. This is a personal research project, so fixes are best-effort.

## Supported versions

Only the latest commit on `main` is supported. There are no released versions.

## Scope and threat model

The harness runs an AI agent (`claude -p`, with `--permission-mode bypassPermissions`) on your machine. It also gives
the agent a GitHub token when you run the GitHub experiment. Things to know before running it:

- **Credentials.** The runner removes every inherited `GH_*`/`GITHUB_*` variable from the agent's environment
  (`extendEnv: false`) and points `gh` at an empty per-trial `GH_CONFIG_DIR`. The GitHub skill arm's Bash runs in
  Claude Code's OS sandbox with no unsandboxed fallback, so it can't read `$HOME` or the keychain. The controller token
  is never passed to the agent. Use fine-grained PATs scoped to a dedicated sandbox org, and give the agent token only
  the permissions in the README.
- **History.** Before 2026-10-02 the scrub did not take effect (execa merged the parent environment back in), and an
  agent could use the controller token or the developer's own `gh` login. That happened in the committed n5 runs. If
  you ran older versions of this harness with real tokens, rotate them.
- **Files.** File tools are denied under `~` and the repo. They can still read elsewhere, notably the per-user temp
  directory (`$TMPDIR`) around the trial directory; those results are redacted from artifacts but the agent sees them.
  Run trials in a container or VM if that matters to you. The Playwright skill arm's Bash is not sandboxed (it needs
  local browsers); treat it like running an untrusted script as your user.
- **Artifacts.** Transcripts are redacted (home paths, out-of-trial file reads) before they are written, but review
  `experiments/*/runs/` before you commit new runs.
- **Test data.** All token-shaped strings under `test/` are fake and exist to test redaction and scrubbing.
