---
name: github-cli
description: Inspect and mutate GitHub state using the gh CLI. Issues, pull requests, repos, releases, workflows, and raw API access.
allowed-tools: Bash(gh:*)
---

# GitHub CLI (`gh`)

`gh` is the official GitHub command-line client. Authenticated via the `GH_TOKEN` / `GITHUB_TOKEN` environment variable. Use it to read and write GitHub state without ever leaving the shell.

## Quick start

```bash
gh repo view OWNER/REPO --json name,description,topics
gh issue list --repo OWNER/REPO --state open --json number,title,labels
gh pr view 42 --repo OWNER/REPO --json title,state,mergeable
gh api repos/OWNER/REPO/contents/README.md --jq '.content' | base64 -d
```

## Core commands

### Repositories

```bash
gh repo view OWNER/REPO                       # human view
gh repo view OWNER/REPO --json description,topics,defaultBranchRef
gh repo list OWNER --json name,visibility,isPrivate
```

### Issues

```bash
gh issue list   --repo OWNER/REPO --state all --json number,title,labels,assignees
gh issue view 7 --repo OWNER/REPO --json title,body,comments
gh issue create --repo OWNER/REPO --title "..." --body "..." --label bug
gh issue edit   7 --repo OWNER/REPO --add-label triaged --add-assignee alice
gh issue comment 7 --repo OWNER/REPO --body "..."
gh issue close   7 --repo OWNER/REPO
```

### Pull requests

```bash
gh pr list  --repo OWNER/REPO --state open --json number,title,mergeable,headRefName
gh pr view  42 --repo OWNER/REPO --json title,state,mergeable,reviewRequests
gh pr diff  42 --repo OWNER/REPO
gh pr create --repo OWNER/REPO --title "..." --body "..." --base main --head feature-x
gh pr review 42 --repo OWNER/REPO --comment --body "..."
gh pr review 42 --repo OWNER/REPO --approve
gh pr review 42 --repo OWNER/REPO --request-changes --body "..."
gh pr merge  42 --repo OWNER/REPO --squash
```

### Releases

```bash
gh release list   --repo OWNER/REPO
gh release view   v1.0.0 --repo OWNER/REPO --json name,body,tagName
gh release create v1.0.0 --repo OWNER/REPO --title "..." --notes "..."
```

### Workflows and runs

```bash
gh workflow list --repo OWNER/REPO
gh run list      --repo OWNER/REPO --workflow ci.yml --json conclusion,createdAt,headSha
gh run view      <run-id> --repo OWNER/REPO --log
```

## JSON output and `--jq`

`--json` selects fields up front (reduces token cost) and `--jq` filters them server-side using jq syntax. Always prefer this over piping to external `jq`.

```bash
gh issue list --repo OWNER/REPO --state open \
  --json number,title,labels \
  --jq '.[] | select(.labels | map(.name) | index("bug")) | {number,title}'
```

`--paginate` follows pagination automatically. Combine with `--jq` to keep output bounded.

```bash
gh issue list --repo OWNER/REPO --state all --paginate \
  --json number,title --jq 'length'
```

## Raw API (`gh api`)

`gh api` is the escape valve when high-level commands don't expose what you need. By default it hits the REST API; pass `graphql` to use GraphQL.

```bash
gh api repos/OWNER/REPO                                           # GET
gh api repos/OWNER/REPO/issues -X GET -f labels=bug -f state=open
gh api repos/OWNER/REPO/issues -f title="..." -f body="..."       # POST (implicit when -f passed)
gh api repos/OWNER/REPO/issues/1 -X PATCH -f state=closed
gh api graphql -f query='query { viewer { login } }' --jq '.data.viewer.login'
```

**Important:** `gh api` defaults to `POST` whenever any `-f`/`--raw-field`/`-F`/`--field`/`--input` flag is passed. Use `--method GET` or `-X GET` explicitly for read-only queries that need query parameters.

## Writing artifacts

When the task asks for a saved file, **use the agent's `Write` tool to save the final artifact**. Do not redirect with `>` or `>>`. Pipe `gh ... --jq` into the prompt only to *see* the data; persist it via Write.

## Authentication

Authentication is pre-configured via env (`GH_TOKEN` or `GITHUB_TOKEN`). You do not need to run `gh auth login`. `gh auth status` shows the active identity if you need to confirm.
