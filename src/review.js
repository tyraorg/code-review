import { openaiPost } from './openai.js';

const OUTPUT_SCHEMA = `
## Output format

Return ONLY a valid JSON array of findings, or the token <!-- NO_ISSUES --> if there are none.
No markdown fences, no explanation outside the array.

Each finding must have:
- "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- "title": short title
- "body": explanation of the issue (plain prose, no code blocks)
- "path": file path relative to repo root
- "line": line number in the diff (the last line of the relevant hunk, RIGHT side)
- "start_line": (optional) first line of a multi-line range
- "suggestion": (optional) verbatim replacement lines for a GitHub suggestion block — actual
  code only, no diff markers, no prose. Omit if no concrete code fix is possible.`;

export async function runReview({ diff, reviewMd, prTitle, prBody, priorReviews, priorReviewCount, model, apiKey, core }) {
  const systemContent = reviewMd ? `${reviewMd}\n${OUTPUT_SCHEMA}` : OUTPUT_SCHEMA;

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
