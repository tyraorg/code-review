import { openaiPost } from './openai.js';

const SKIP_PATTERNS = [
  /\.lock$/,
  /^(dist|build)\//,
  /\.(png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot)$/i,
  /^public\//,
  /\/(i18n|locales?|translations?)\//,
  /\.(po|pot|mo)$/,
  /^(CHANGELOG|LICENCE|LICENSE|NOTICE)(\..*)?$/i,
  /\.md$/,
];

const GATE_DIFF_LIMIT = 6000;

function isReviewable(filename) {
  return !SKIP_PATTERNS.some((re) => re.test(filename));
}

export async function runGate({ changedFiles, diff, prTitle, prBody, apiKey, gateModel, core }) {
  const reviewable = changedFiles.filter((f) => isReviewable(f.filename));

  if (reviewable.length === 0) {
    const names = changedFiles.map((f) => f.filename).join(', ');
    core.info(`Gate: skipping — no reviewable files (${names})`);
    return false;
  }

  core.debug(`Gate: ${reviewable.length} reviewable file(s) of ${changedFiles.length} total`);
  core.debug(`Gate: reviewable files — ${reviewable.map((f) => f.filename).join(', ')}`);

  if (!apiKey) {
    core.info('Gate: no API key — defaulting to review');
    return true;
  }

  const fileList = reviewable
    .map((f) => `${f.filename} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  const diffSnippet = diff
    ? diff.slice(0, GATE_DIFF_LIMIT) + (diff.length > GATE_DIFF_LIMIT ? '\n… (truncated)' : '')
    : '(not available)';

  core.debug(`Gate: diff snippet length ${diffSnippet.length} chars (full diff ${diff?.length ?? 0} chars)`);

  const system = `You decide whether a code change warrants an automated security and correctness review.
Reply with exactly one word: YES or NO.
YES — if any changed file could plausibly introduce a bug, security vulnerability, or data-handling error.
NO  — only if every change is trivially safe. Safe-only examples: comment edits, UI string/copy changes, whitespace or formatting, renaming without logic change, dependency version bumps with no behaviour change.
When in doubt, answer YES.`;

  const user = `PR: ${prTitle}${prBody ? `\nDescription: ${prBody.slice(0, 400)}` : ''}

Changed files:
${fileList}

Diff (possibly truncated):
\`\`\`diff
${diffSnippet}
\`\`\``;

  try {
    const resp = await openaiPost(apiKey, {
      model: gateModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 5,
      temperature: 0,
    }, core);

    const answer = (resp.choices?.[0]?.message?.content || 'YES').trim().toUpperCase();
    const run = !answer.startsWith('NO');
    core.debug(`Gate: raw LLM answer "${answer}"`);
    core.info(`Gate: ${run ? 'running' : 'skipping'} review (LLM answered "${answer}")`);
    return run;
  } catch (e) {
    core.warning(`Gate: LLM error (defaulting to review): ${e.message}`);
    return true;
  }
}
