# Directed-prompt experiment — `tier2_file_patch_pr_directed`

## Question

In the tier2-n5 run, the skill arm on `tier2_file_patch_pr` scored **5/5 raw success / 0/5 valid surface** — every trial converged on the same `base64 -d` + shell variable assignment pattern to construct a file payload for `gh api`. The hypothesis: this was a *prompt-knowledge gap*, not an *affordance gap*. With explicit guidance pointing to `gh api --input file` and the `Write` tool, the agent should stay in surface.

## Method

Added a parallel task `tier2_file_patch_pr_directed` that shares setup/successCheck with the original but adds explicit tooling guidance to the prompt:

- "The ONLY allowed Bash command is `gh ...`. Shell helpers, pipes, redirections, variable assignments, and command substitution are NOT allowed."
- "When you need to pass file content or a JSON body to `gh api`, write the content to a local file using the `Write` tool, then point `gh` at it:"
  - `gh api ENDPOINT -F field=@local-file`
  - `gh api ENDPOINT --input request.json`

Ran 5 trials, skill arm only, model `claude-sonnet-4-6`, 240 s wall budget.

## Result

| Trial | Pass | Valid | Turns | Time | What happened |
|---|---|---|---|---|---|
| 1 | ✓ | **valid** | 32 | 120 s | Full directed path through the low-level Git data API |
| 2 | ✓ | INVALID | 29 | 117 s | Directed writes, but `base64 -d` on read |
| 3 | ✗ | INVALID | 14 | timeout | `base64 -d` early, partial directed write, hit 240 s wall |
| 4 | ✓ | INVALID | 30 | 87 s | Directed writes, `base64 -d` on read |
| 5 | ✗ | **valid** | 11 | timeout | Directed path, didn't finish in 240 s |

## Comparison vs original prompt

| Metric | `tier2_file_patch_pr` (tier2-n5) | `tier2_file_patch_pr_directed` |
|---|---|---|
| Pass success | 5/5 | **3/5** |
| Valid surface | 0/5 | **2/5** |
| Avg turns (passing) | ~13 | ~30 (2.3×) |
| Avg time (passing) | ~35 s | ~108 s (3.1×) |
| Avg tokens (passing) | ~144 k | ~374 k (2.6×) |

## Findings

**1. The directed prompt halves the escape rate but doesn't eliminate it.** Validity went from 0/5 to 2/5. The agent does pick up the `Write` + `gh api --input` pattern when explicitly told — but not on every seed.

**2. The failure mode has two halves.** Both INVALID trials (2, 4) adopted the directed pattern *on the write side* (creating refs, blobs, trees, commits, pulls via `--input` files) but **reverted to `base64 -d` on the read side** for decoding the existing `widget.ts` content. The directed prompt taught how to pass content *to* `gh api`, not how to read decoded content *from* it. The in-surface read pattern would have been `gh api ENDPOINT -H "Accept: application/vnd.github.raw+json"`, which the prompt did not name. The agent picks up the specific guidance it's given but doesn't generalize across the read/write boundary.

**3. Compliance is expensive.** When the agent does follow the directed path, it walks the low-level Git data API end-to-end (refs → blobs → trees → commits → refs/heads → pulls), uses the `Write` tool 7 times to stage JSON request bodies, and burns ~30 turns / ~108 s — versus ~13 turns / ~35 s for the original out-of-surface path. The directed prompt pushed the agent away from the `/repos/{owner}/{repo}/contents/{path}` shortcut (which handles all the tree/commit work internally) toward the lower-level Git data primitives that fit cleanly into "one `gh api` call per Write-staged JSON body."

**4. Pass rate dropped.** 3/5 instead of 5/5. The two timeouts (trials 3, 5) both ran out of wall time partway through the longer directed workflow. At a 360 s budget the pass rate would likely recover, but the underlying cost (turns/tokens) is structural.

## What this is evidence for

The affordance gap in `file_patch_pr` for the gh CLI is **real and not closed by a single paragraph of prompt engineering**. Even with explicit naming of the in-surface workaround, the agent:

- only adopts the pattern on the side of the workflow the prompt names (write), not symmetrically across read+write
- pays a 2-3× cost penalty in tokens and turns when it does adopt the pattern
- has a smaller success rate inside a fixed wall budget

A more aggressive prompt rewrite — naming the `-H "Accept: ..."` pattern for reads as well — might push the validity rate higher, but at the methodological cost of measuring prompt engineering rather than tool surface. The MCP arm achieved 5/5 valid at ~13 turns / 90 k tokens with no prompt-side guidance about how to do file mutations; the surface design encoded the workflow primitives natively.
