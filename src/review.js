import { openaiPost } from './openai.js';

const BUILT_IN_RULES = `
## General

Be concise and specific. Only flag real issues — do not pad with generic advice.
Do not suggest running build, install, or test commands.

## Scope

Only flag issues on lines present in the diff. Do not flag issues in unchanged lines, even if surrounding context reveals a problem.

## What not to flag

- Style, naming, formatting, or refactoring — handled by linters, out of scope.
- Anything CI already enforces: type errors, lint, formatting.
- Generated, compiled, or vendored files (build output, lockfiles, third-party code).
- Test-only code that intentionally violates production rules.
- Speculative or purely cosmetic observations with no concrete harm.

## Security baseline

- Hardcoded secrets or API keys — Critical; all secrets must come from environment variables.
- PII in logs, error messages, or analytics events — High.
- User-supplied data rendered without sanitization — at least High.

## Behaviour by review round

Your prompt includes PRIOR_REVIEW_COUNT — the number of automated reviews already posted on this PR.

- 0 — First pass. Review the full diff thoroughly.
- 1 — One round done. Review for new issues; prioritise checking whether prior issues are addressed.
- 2 — Two rounds done. Focus on whether prior issues are resolved. Only flag new Critical or High issues.
- 3+ — Focus on verifying all prior issues are resolved. Only flag genuinely new Critical or High issues.

Do not re-raise any issue already listed in previous reviews. If a prior issue remains unresolved, note it briefly inside the body of a related finding rather than creating a separate one.

## Self-screening

Before finalising output, discard any finding that:
- Cannot be demonstrated by a specific line present in the diff
- Falls under "What not to flag" above
- Duplicates an issue already in the previous reviews

## Output format

Return ONLY a valid JSON array of findings, or the token <!-- NO_ISSUES --> if there are none.
No markdown fences, no explanation outside the array.

Each finding must have these fields:
- "path": relative file path (e.g. "src/hooks/useData.ts")
- "line": line number of the last line of the affected range; must be a line present in the diff
- "start_line": (optional) first line of a multi-line range; omit for single-line findings
- "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- "title": 5–10 word summary
- "body": markdown explanation of the issue and its risk
- "suggestion": (optional) verbatim replacement code for the flagged lines only — no surrounding
  unchanged context, no diff markers, no prose. Omit if no concrete code fix can be proposed.`;

export async function runReview({ diff, reviewMd, prTitle, prBody, priorReviews, priorReviewCount, model, apiKey, core }) {
  const systemContent = reviewMd ? `${reviewMd}\n${BUILT_IN_RULES}` : BUILT_IN_RULES;

  const userParts = [
    `PR: ${prTitle}`,
    `PRIOR_REVIEW_COUNT: ${priorReviewCount}`,
  ];

  if (prBody) userParts.push(`\nPR description:\n${prBody}`);
  if (priorReviews) userParts.push(`\nPrevious reviews:\n${priorReviews}`);
  userParts.push(`\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``);

  const userMessage = userParts.join('\n');

  core.debug(`Review: model=${model} system=${systemContent.length} chars user=${userMessage.length} chars`);

  try {
    const resp = await openaiPost(apiKey, {
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
    }, core);

    const content = resp.choices?.[0]?.message?.content;
    if (!content) {
      core.warning('Review: empty response from OpenAI');
      return '<!-- NO_ISSUES -->';
    }

    core.debug(`Review: raw output (first 500 chars): ${content.slice(0, 500)}`);
    return content;
  } catch (e) {
    core.warning(`Review: OpenAI error — ${e.message}`);
    return '<!-- NO_ISSUES -->';
  }
}
