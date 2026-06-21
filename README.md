# Code Review

Automated PR code review using OpenAI. Reads your `REVIEW.md` as domain-specific review instructions, runs a three-stage pipeline (gate → review → screen), and posts findings as inline GitHub review comments.

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

      - uses: tyraorg/code-review@v0
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ github.token }}
```

## How it works

**Gate** — Before calling the review model the action checks whether the PR is worth reviewing at all. It first filters out files that can never introduce bugs (lock files, assets, translations, markdown). If reviewable files remain it sends the file list and a truncated diff to `gate-model` and asks for a YES/NO decision. PRs that touch only comments, copy changes, whitespace, or trivial renames are skipped with no further API calls.

**Review** — The diff and the contents of `REVIEW.md` are sent to `model` via the OpenAI chat completions API. The action automatically appends built-in rules covering scope, output format, quality filters, a security baseline, and round behaviour — so your `REVIEW.md` only needs to describe what is specific to your project.

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

Create a `REVIEW.md` at the root of your repository. This file is your review brief — describe what the model should look for and what it should ignore. The action handles scope enforcement and output format automatically; do not include those in your file.

The action automatically handles scope enforcement, output format, round behaviour (dedup across review iterations), general quality rules (no style/lint findings, no speculative observations), and a security baseline (no hardcoded secrets, no PII in logs). You do not need to describe any of those.

Put only project-specific context in `REVIEW.md`:

- What kind of project this is and the language/framework in use
- Security rules specific to your stack (e.g. which sanitization library to use, how your auth model works, which query patterns must be scoped)
- Any severity overrides for your domain

Example:

```markdown
# Code Review Instructions

You are reviewing a Pull Request for a React/TypeScript web application.

## Security
- User input passed to `dangerouslySetInnerHTML` without sanitization — Critical
- All database queries must be scoped to the current user — High
```

If no `REVIEW.md` is found, the action runs with the built-in rules only.

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
