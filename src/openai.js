import { HttpClient } from '@actions/http-client';
import { BearerCredentialHandler } from '@actions/http-client/lib/auth';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export async function openaiPost(apiKey, body, core) {
  const client = new HttpClient('tyra-code-review-action', [
    new BearerCredentialHandler(apiKey),
  ]);

  core.debug(`OpenAI request: model=${body.model} messages=${body.messages.length}${body.max_tokens ? ` max_tokens=${body.max_tokens}` : ''}`);

  const res = await client.postJson(OPENAI_URL, body);

  if (res.statusCode !== 200) {
    throw new Error(`OpenAI API returned ${res.statusCode}: ${JSON.stringify(res.result)}`);
  }

  const usage = res.result?.usage;
  if (usage) {
    core.debug(`OpenAI usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`);
  }

  return res.result;
}
