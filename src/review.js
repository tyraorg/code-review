import { openaiPost } from './openai.js';

export async function runReview({ diff, reviewMd, prTitle, prBody, priorReviews, priorReviewCount, model, apiKey, core }) {
  const userParts = [
    `PR: ${prTitle}`,
    `PRIOR_REVIEW_COUNT: ${priorReviewCount}`,
  ];

  if (prBody) userParts.push(`\nPR description:\n${prBody}`);
  if (priorReviews) userParts.push(`\nPrevious reviews:\n${priorReviews}`);
  userParts.push(`\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``);

  const userMessage = userParts.join('\n');

  core.debug(`Review: model=${model} system=${reviewMd.length} chars user=${userMessage.length} chars`);

  try {
    const resp = await openaiPost(apiKey, {
      model,
      messages: [
        { role: 'system', content: reviewMd },
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
