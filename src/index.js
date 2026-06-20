import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import { runGate } from './gate.js';
import { runReview } from './review.js';
import { screenFindings } from './screen.js';
import { postReview } from './post.js';

async function run() {
  const apiKey = core.getInput('openai-api-key', { required: true });
  const githubToken = core.getInput('github-token', { required: true });
  const reviewerToken = core.getInput('reviewer-token') || githubToken;
  const reviewInstructionsPath = core.getInput('review-instructions') || 'REVIEW.md';
  const model = core.getInput('model') || 'gpt-4o';
  const gateModel = core.getInput('gate-model') || 'gpt-4o-mini';

  core.debug(`Config: model=${model} gate-model=${gateModel} review-instructions=${reviewInstructionsPath} reviewer=${reviewerToken !== githubToken ? 'custom' : 'github-token'}`);

  const octokit = github.getOctokit(githubToken);
  const reviewOctokit = reviewerToken !== githubToken ? github.getOctokit(reviewerToken) : octokit;
  const ctx = github.context;
  const { owner, repo } = ctx.repo;
  const pullNumber = ctx.payload.pull_request?.number;

  if (!pullNumber) {
    core.setFailed('This action must run on pull_request events.');
    return;
  }

  core.debug(`PR: ${owner}/${repo}#${pullNumber}`);

  // 1. Fetch changed files for gate
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner, repo, pull_number: pullNumber, per_page: 100,
  });

  const changedFiles = files.map((f) => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    status: f.status,
  }));

  core.debug(`Files: ${changedFiles.length} changed — ${changedFiles.map((f) => f.filename).join(', ')}`);

  const prTitle = ctx.payload.pull_request.title || '';
  const prBody = ctx.payload.pull_request.body || '';
  const baseSha = ctx.payload.pull_request.base.sha;
  const headSha = ctx.payload.pull_request.head.sha;

  // 2. Fetch diff (used by both gate and review)
  let diff = '';
  await exec.exec('git', ['diff', `${baseSha}...${headSha}`], {
    listeners: { stdout: (data) => { diff += data.toString(); } },
    silent: true,
  });

  core.debug(`Diff: ${diff.length} chars`);

  if (!diff.trim()) {
    core.info('Gate: empty diff — nothing to review.');
    core.setOutput('should-review', 'false');
    core.setOutput('verdict', 'NO_ISSUES');
    return;
  }

  // 3. Gate
  const shouldReview = await runGate({ changedFiles, diff, prTitle, prBody, apiKey, gateModel, core });
  core.setOutput('should-review', String(shouldReview));

  if (!shouldReview) {
    core.info('Gate: skipping review.');
    return;
  }

  // 4. Fetch existing reviews for dedup + round-count
  const { data: existingReviews } = await octokit.rest.pulls.listReviews({
    owner, repo, pull_number: pullNumber, per_page: 100,
  });

  const priorReviewCount = existingReviews.filter(
    (r) => r.state !== 'DISMISSED' && r.body
  ).length;

  const priorReviews = existingReviews
    .filter((r) => r.state !== 'DISMISSED' && r.body)
    .map((r) => `[${r.state}] ${r.user.login}: ${r.body}`)
    .join('\n---\n') || 'No previous reviews.';

  core.debug(`Prior reviews: ${priorReviewCount}`);

  // 5. Read review instructions
  const instructionsFile = join(process.env.GITHUB_WORKSPACE || '.', reviewInstructionsPath);
  let reviewMd = '';
  if (existsSync(instructionsFile)) {
    reviewMd = readFileSync(instructionsFile, 'utf8');
    core.debug(`Review instructions: ${reviewMd.length} chars from ${instructionsFile}`);
  } else {
    core.warning(`Review instructions file not found: ${reviewInstructionsPath} — using empty instructions.`);
  }

  // 6. Run review
  const reviewOutput = await runReview({
    diff, reviewMd, prTitle, prBody,
    priorReviews, priorReviewCount,
    model, apiKey, core,
  });

  // 7. Parse verdict
  let verdict;
  if (reviewOutput.includes('<!-- NO_ISSUES -->')) {
    verdict = 'NO_ISSUES';
  } else if (reviewOutput.includes('<!-- VERDICT: REQUEST_CHANGES -->')) {
    verdict = 'REQUEST_CHANGES';
  } else {
    verdict = 'COMMENT';
  }
  core.setOutput('verdict', verdict);
  core.info(`Review verdict: ${verdict}`);

  // 8. Screen findings
  const findings = await screenFindings({
    reviewOutput, previousReviews: priorReviews,
    apiKey, gateModel, core,
  });

  // 9. Post review
  await postReview({ octokit: reviewOctokit, context: ctx, verdict, findings, core });
}

run().catch((e) => core.setFailed(e.message));
