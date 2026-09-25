import { spawn } from 'node:child_process';
import { http, log, warn, sleep, extractJSON } from './util.js';

const TRANSIENT = /unable to connect|ECONNRESET|ETIMEDOUT|socket hang up|overloaded|529|5\d\d|timed out/i;

const SYSTEM = {
  writer: 'You are a ghostwriter for one developer\'s X (Twitter) account. ' +
    'You follow the voice guide and playbook exactly, never invent facts, and reply with a single JSON object only.',
  worker: 'You are a precise research assistant. You only restate facts present in the input, ' +
    'never add outside knowledge, and reply with a single JSON object only.',
};

/** True when a Claude credential is available to the CLI in CI. Locally, `claude` login also works. */
export const hasClaudeCredential = () => Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);

/**
 * Claude Code CLI in print mode with every tool disabled: one prompt in, one answer out.
 * Auth is CLAUDE_CODE_OAUTH_TOKEN (subscription, from `claude setup-token`) or ANTHROPIC_API_KEY.
 *
 * role 'writer' = the expensive model that writes the post (llm.claude).
 * role 'worker' = the cheap model for token-heavy prep: triage, condensing (llm.worker).
 */
export function callClaude(prompt, cfg, role = 'writer') {
  const c = role === 'worker' ? cfg.llm.worker : cfg.llm.claude;
  const args = ['-p', '--output-format', 'json', '--model', c.model, '--tools', '',
    '--no-session-persistence', '--system-prompt', SYSTEM[role]];
  if (c.effort) args.push('--effort', c.effort);

  return new Promise((resolve, reject) => {
    // The worker's prep tasks don't need extended thinking; turning it off cuts its output tokens ~10x.
    const env = c.thinking === false ? { ...process.env, MAX_THINKING_TOKENS: '0' } : process.env;
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude timed out after ${c.timeoutSeconds}s`)); },
      (c.timeoutSeconds ?? 300) * 1000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`could not start claude CLI: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let j;
      try { j = JSON.parse(out); } catch {
        return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 300)}`));
      }
      if (j.is_error || j.subtype !== 'success') return reject(new Error(`claude: ${String(j.result || j.subtype).slice(0, 300)}`));
      const u = j.usage || {};
      const models = Object.entries(j.modelUsage || {}).map(([m, v]) => `${m}=$${(v.costUSD ?? 0).toFixed(3)}`).join(' ');
      log(`claude ${role}: ${c.model} ok (in ${u.input_tokens ?? 0} + cache-write ${u.cache_creation_input_tokens ?? 0} + cache-read ${u.cache_read_input_tokens ?? 0}, ` +
        `out ${u.output_tokens ?? 0}; ~$${(j.total_cost_usd ?? 0).toFixed(3)} at API rates${models ? `; ${models}` : ''})`);
      if (process.env.LLM_DEBUG) console.error(JSON.stringify({ usage: u, modelUsage: j.modelUsage }, null, 1));
      resolve(j.result);
    });
    child.stdin.end(prompt);
  });
}

async function callGemini(model, prompt, cfg) {
  const res = await http(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: cfg.llm.gemini.temperature ?? 1.0, maxOutputTokens: 4096, responseMimeType: 'application/json' },
    }),
  }, { label: `gemini:${model}`, retries: 1 });
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.json?.error?.message || res.body.slice(0, 200)}`), { status: res.status });
  const cand = res.json?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error(`empty response (finishReason=${cand?.finishReason ?? 'unknown'})`);
  return text;
}

/**
 * Ask the configured provider for a JSON object. Falls through to Gemini only
 * when a Gemini key exists, so a missing credential is an error, not a silent downgrade.
 */
export async function generateJSON(prompt, cfg, role = 'writer') {
  const errors = [];
  const order = cfg.llm.provider === 'gemini' ? ['gemini', 'claude'] : ['claude', 'gemini'];
  for (const provider of order) {
    if (provider === 'gemini' && !process.env.GEMINI_API_KEY) continue;
    if (provider === 'claude') {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const parsed = extractJSON(await callClaude(prompt, cfg, role));
          if (!parsed) throw new Error('response was not JSON');
          return { model: (role === 'worker' ? cfg.llm.worker : cfg.llm.claude).model, parsed };
        } catch (e) {
          errors.push(e.message); warn(e.message);
          if (!TRANSIENT.test(e.message) || attempt === 2) break;
          await sleep(5000);
        }
      }
    } else {
      for (const model of cfg.llm.gemini.models) {
        try {
          const parsed = extractJSON(await callGemini(model, prompt, cfg));
          if (!parsed) throw new Error('response was not JSON');
          return { model, parsed };
        } catch (e) {
          errors.push(`gemini ${model}: ${e.message}`); warn(`gemini ${model}: ${e.message}`);
          if (e.status && ![400, 403, 404, 429].includes(e.status)) break;
        }
      }
    }
  }
  throw new Error(`no LLM provider answered — ${errors.join(' | ') || 'no provider configured'}`);
}
