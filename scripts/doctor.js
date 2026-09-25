import { loadConfig, loadVoice, loadPlaybook, http, inZone, zonedTime } from '../src/util.js';
import { getOrganizationId, listChannels } from '../src/publish/buffer.js';
import { callClaude, hasClaudeCredential } from '../src/llm.js';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failures++; };
const note = (m) => console.log(`  · ${m}`);
let failures = 0;

console.log('\nx-autopilot setup check\n');

const cfg = loadConfig();
console.log('config');
ok(`github user: ${cfg.github.username}`);
cfg.identity.handle ? ok(`X handle: @${cfg.identity.handle}`) : note('identity.handle is empty — set your X handle in config.json');
loadVoice().length > 200 ? ok('voice.md loaded') : bad('voice.md is missing or nearly empty');
loadPlaybook().length > 200 ? ok('playbook.md loaded') : bad('playbook.md is missing or nearly empty');
const tz = cfg.schedule.audienceTimezone;
for (const slot of cfg.schedule.slots) {
  const at = zonedTime(inZone(new Date(), tz).date, slot.at, tz);
  const ist = at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Calcutta', hour: '2-digit', minute: '2-digit' });
  const types = [slot.type, ...Object.entries(slot.byWeekday || {}).map(([d, t]) => `${t} on ${d}`)].join(', ');
  ok(`${slot.id} slot goes live ${slot.at} ${tz} (today: ${at.toISOString().slice(11, 16)} UTC, ${ist} IST) — ${types}`);
}
note(`posting days: ${(cfg.schedule.days || []).join(' ') || 'every day'}`);

console.log('\nGitHub (recap source)');
try {
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await http(`https://api.github.com/users/${cfg.github.username}`, { headers }, { retries: 1 });
  r.ok ? ok(`user found: ${r.json.name || r.json.login} (${r.json.public_repos} public repos)`)
       : bad(`user lookup failed: HTTP ${r.status}`);
} catch (err) { bad(`GitHub: ${err.message}`); }

console.log('\nClaude (writer + worker)');
if (process.env.CI && !hasClaudeCredential()) bad('CLAUDE_CODE_OAUTH_TOKEN not set — run `claude setup-token` and add it as a repo secret');
for (const role of ['worker', 'writer']) {
  const model = role === 'worker' ? cfg.llm.worker.model : cfg.llm.claude.model;
  try {
    const out = await callClaude('Reply with exactly: {"ok":true}', cfg, role);
    /ok/.test(out) ? ok(`${role} ${model} responded`) : bad(`${role} ${model} gave an unexpected reply: ${out.slice(0, 80)}`);
  } catch (err) { bad(`${role} ${model}: ${err.message}`); }
}

console.log('\nBuffer → X');
if (!process.env.BUFFER_API_KEY) bad('BUFFER_API_KEY not set');
else {
  try {
    const org = await getOrganizationId();
    ok(`org: ${org.name} (${org.email})`);
    const channels = await listChannels(org.id);
    const x = channels.find((c) => /twitter|^x$/i.test(String(c.service)));
    for (const c of channels) {
      const isX = c === x;
      console.log(`  ${isX ? '✓' : '·'} ${c.displayName || c.name} — service="${c.service}" id=${c.id}${c.isQueuePaused ? ' [QUEUE PAUSED]' : ''}`);
    }
    x ? ok(`will publish to X as: ${x.displayName || x.name}`) : bad('no X channel connected in Buffer');
    if (x?.isQueuePaused) bad('the X channel\'s queue is paused — unpause it in Buffer or nothing will publish');
  } catch (err) { bad(`Buffer: ${err.message}`); }
}

console.log(failures ? `\n${failures} problem(s) to fix.\n` : '\nAll good. Try: npm run dry\n');
process.exit(failures ? 1 : 0);
