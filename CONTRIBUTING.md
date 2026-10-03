# Contributing

Thanks for taking a look. This is a small research harness, so the process is light.

1. Use Node 24 and pnpm 12 (`corepack enable`), then `pnpm install`.
2. Make your change on a branch. Keep the harness shared: add an experiment as one file under
   `harness/src/experiments/` plus tasks under `experiments/<name>/tasks/`; don't fork harness code per experiment.
3. Run `pnpm check` (typecheck, lint, format check, tests). Add or update tests for behavior you change, especially
   classifiers, isolation, and token handling.
4. If you change an arm's tools or isolation, run `pnpm harness verify-arms --experiment <name>` and say so in the PR.
5. Don't commit secrets or unredacted run artifacts. Run `pnpm harness redact-artifacts` before committing runs.
6. Use [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`...).

Report security issues privately; see [SECURITY.md](SECURITY.md).
