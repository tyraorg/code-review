# Code Review

Automated PR code review using OpenAI. Reads your own `REVIEW.md` as the review brief, runs a three-stage pipeline (gate → review → screen), and posts findings as inline GitHub review comments.

## Usage

```yaml
jobs:
  code-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: refs/pull/${{ github.event.pull_request.number }}/merge

      - name: Pre-fetch base and head refs
        env:
          PR_BASE_REF: ${{ github.event.pull_request.base.ref }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          git fetch --no-tags origin \
            "$PR_BASE_REF" \
            "+refs/pull/$PR_NUMBER/head"

      - uses: tyraorg/code-review@v0.0.1
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ github.token }}
```

The checkout and pre-fetch steps are required so the action can run `git diff` to produce the diff it reviews.

## How it works

**Gate** — Before calling the review model the action checks whether the PR is worth reviewing at all. It first filters out files that can never introduce bugs (lock files, assets, translations, markdown). If reviewable files remain it sends the file list and a truncated diff to `gate-model` and asks for a YES/NO decision. PRs that touch only comments, copy changes, whitespace, or trivial renames are skipped with no further API calls.

**Review** — The diff and the contents of `REVIEW.md` are sent to `model` via the OpenAI chat completions API. The model's output is expected to follow the format described in `REVIEW.md`: a verdict marker followed by a JSON array of findings.

**Screen** — A second, cheaper call to `gate-model` removes findings that duplicate an existing review, are style/formatting suggestions, or are vague and undemonstrated. Only genuine security vulnerabilities and correctness bugs survive.

**Post** — Surviving findings are posted as inline GitHub review comments on the PR, grouped under a single review with a severity summary. If no issues are found the PR is approved.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `openai-api-key` | Yes | — | OpenAI API key |
| `github-token` | Yes | — | Token used to read PR data (files, existing reviews) and post the review |
| `reviewer-token` | No | `github-token` | PAT for the account that posts review comments. Set this to have comments appear from a dedicated bot account rather than `github-actions[bot]` |
| `review-instructions` | No | `REVIEW.md` | Path (relative to the repository root) to the file containing review instructions |
| `model` | No | `gpt-4o` | OpenAI model used for the main code review |
| `gate-model` | No | `gpt-4o-mini` | OpenAI model used for the gate and screening steps |

## Outputs

| Output | Description |
|---|---|
| `verdict` | `NO_ISSUES`, `REQUEST_CHANGES`, or `COMMENT` |
| `should-review` | `true` or `false` — whether the gate decided a review was warranted |

## REVIEW.md

The action reads `REVIEW.md` from the root of your repository and uses it as the system prompt for the review model. This file is where you define what to look for, what to ignore, severity levels, output format, and any project-specific rules.

The model's output must follow a specific format for the action to parse it correctly:

```
<!-- NO_ISSUES -->
```

or

```
<!-- VERDICT: REQUEST_CHANGES -->
[
  {
    "path": "src/components/Foo.tsx",
    "line": 42,
    "start_line": 40,
    "severity": "HIGH",
    "title": "Short title",
    "body": "Markdown explanation of the issue.",
    "suggestion": "optional replacement code"
  }
]
```

Use `<!-- VERDICT: COMMENT -->` when all findings are Medium or Low severity.

## Debug logging

Set the `ACTIONS_STEP_DEBUG` secret to `true` in your repository to enable verbose logging. Debug output includes the gate decision and reasoning, token usage for each API call, finding counts before and after screening, and the path and severity of each inline comment posted.

## Permissions

The job running this action needs:

```yaml
permissions:
  contents: read
  pull-requests: write
```

If you supply a `reviewer-token`, only `contents: read` is strictly needed on the job — the write permission is exercised by the token itself.
