/**
 * Returns true if the suggestion looks like prose rather than replacement code.
 * Markdown inline-code spans (e.g. `identifier`) never appear in real code suggestions.
 * A line with no code operators that reads as a complete sentence is also prose.
 */
function isProse(suggestion) {
  if (/`(?![^`]*\${)[^`\n]+`/.test(suggestion)) return true;
  const hasCodeChars = /[=({[<>;]/.test(suggestion);
  return !hasCodeChars && /^[A-Z][a-z].+[.!?]$/m.test(suggestion.trim());
}

export async function postReview({ octokit, context, verdict, findings, core }) {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request.number;
  const headSha = context.payload.pull_request.head.sha;

  core.debug(`Post: verdict=${verdict} findings=${findings?.length ?? 0}`);

  if (verdict === 'NO_ISSUES') {
    core.info('Post: approving PR (no issues)');
    await octokit.rest.pulls.createReview({
      owner, repo, pull_number: pullNumber,
      event: 'APPROVE',
      body: '',
    });
    return;
  }

  if (!Array.isArray(findings) || findings.length === 0) {
    core.info('Post: no findings after screening — skipping review.');
    return;
  }

  const event = verdict === 'REQUEST_CHANGES' ? 'REQUEST_CHANGES' : 'COMMENT';
  const emojiMap = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵' };

  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  const parts = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    .filter((s) => counts[s])
    .map((s) => `${emojiMap[s]} ${counts[s]} ${s[0]}${s.slice(1).toLowerCase()}`);

  const summaryBody = `**Automated review:** ${parts.join(' · ')} — see inline comments.`;

  core.info(`Post: submitting ${event} review with ${findings.length} inline comment(s) — ${parts.join(', ')}`);

  await octokit.rest.pulls.createReview({
    owner, repo, pull_number: pullNumber,
    commit_id: headSha,
    body: summaryBody,
    event,
  });

  for (const finding of findings) {
    const emoji = emojiMap[finding.severity] || '';
    let body = `**${emoji} ${finding.title}**\n\n${finding.body}`;

    if (finding.suggestion && !isProse(finding.suggestion)) {
      body += `\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``;
    } else if (finding.suggestion) {
      core.debug(`Post: dropping prose suggestion for ${finding.path}:${finding.line}`);
    }

    core.debug(`Post: inline comment ${finding.path}:${finding.line} [${finding.severity}] ${finding.title}`);

    const params = {
      owner, repo,
      pull_number: pullNumber,
      commit_id: headSha,
      path: finding.path,
      line: finding.line,
      side: 'RIGHT',
      body,
    };

    if (finding.start_line && finding.start_line < finding.line) {
      params.start_line = finding.start_line;
      params.start_side = 'RIGHT';
    }

    try {
      await octokit.rest.pulls.createReviewComment(params);
    } catch (e) {
      core.warning(`Could not post inline comment for ${finding.path}:${finding.line} — ${e.message}`);
    }
  }
}
