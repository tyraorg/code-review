import { openaiPost } from './openai.js';

export async function screenFindings({ reviewOutput, previousReviews, apiKey, gateModel, core }) {
  if (reviewOutput.includes('<!-- NO_ISSUES -->')) return [];

  const jsonMatch = reviewOutput.match(/\[[\s\S]*?\]/);
  let findings;
  try {
    findings = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
  } catch {
    return [];
  }

  if (!Array.isArray(findings) || findings.length === 0) return [];

  core.debug(`Screen: ${findings.length} finding(s) before screening`);
  core.debug(`Screen: finding titles — ${findings.map((f) => f.title).join(' | ')}`);

  const system = `You screen automated code review findings for relevance and quality.
Return ONLY a valid JSON array with irrelevant findings removed. No markdown fences, no explanation, just the array.

Remove a finding if it:
- Duplicates an issue already raised in the previous reviews
- Is a style, naming, formatting, or refactoring suggestion
- Is about a generated file (/dist, /build, *.lock)
- Is about test-only code
- Is vague or speculative — not clearly demonstrated by the code

Keep all genuine security vulnerabilities and correctness bugs.`;

  const user = `Previous reviews:\n${previousReviews || 'None'}\n\nFindings to screen:\n${JSON.stringify(findings, null, 2)}`;

  try {
    const resp = await openaiPost(apiKey, {
      model: gateModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
    }, core);

    const content = resp.choices?.[0]?.message?.content || '';
    core.debug(`Screen: raw response (first 500 chars): ${content.slice(0, 500)}`);

    const match = content.match(/\[[\s\S]*\]/);
    const screened = JSON.parse(match ? match[0] : JSON.stringify(findings));
    core.debug(`Screen: ${screened.length} finding(s) after screening`);
    return screened;
  } catch (e) {
    core.warning(`Screening error: ${e.message}`);
    return findings;
  }
}
