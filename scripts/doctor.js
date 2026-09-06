import { loadConfig, loadVoice, log, http } from '../src/util.js';
import { getOrganizationId, listChannels } from '../src/publish/buffer.js';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failures++; };
let failures = 0;

console.log('\nx-autopilot setup check\n');

const cfg = loadConfig();
console.log('config.json');
ok(`github user: ${cfg.github.username}`);
ok(`timezone: ${cfg.schedule.timezone}, ${cfg.schedule.postsPerWeek}x/week`);
loadVoice().length > 200 ? ok('voice.md loaded') : bad('voice.md is missing or nearly empty — post quality depends on it');

console.log('\nGitHub');
try {
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await http(`https://api.github.com/users/${cfg.github.username}`, { headers }, { retries: 1 });
  r.ok ? ok(`user found: ${r.json.name || r.json.login} (${r.json.public_repos} public repos)`)
       : bad(`user lookup failed: HTTP ${r.status}`);
  const e = await http(`https://api.github.com/users/${cfg.github.username}/events/public?per_page=100`, { headers }, { retries: 1 });
  if (e.ok) {
    const recent = (e.json || []).filter((x) => Date.now() - new Date(x.created_at) < 7 * 864e5);
    recent.length ? ok(`${recent.length} public events in the last 7 days`)
                  : bad('no public events in the last 7 days — the bot will skip rather than invent a post');
  }
} catch (err) { bad(`GitHub: ${err.message}`); }

console.log('\nGemini');
if (!process.env.GEMINI_API_KEY) bad('GEMINI_API_KEY not set');
else {
  let hit = false;
  for (const m of cfg.llm.models) {
    try {
      const r = await http(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }] }),
      }, { retries: 0 });
      if (r.ok) { ok(`${m} responded`); hit = true; break; }
      console.log(`  · ${m}: HTTP ${r.status} ${(r.json?.error?.message || '').slice(0, 80)}`);
    } catch (err) { console.log(`  · ${m}: ${err.message}`); }
  }
  if (!hit) bad('no configured Gemini model answered — check the key, or update llm.models in config.json');
}

console.log('\nBuffer');
if (!process.env.BUFFER_API_KEY) bad('BUFFER_API_KEY not set');
else {
  try {
    const org = await getOrganizationId();
    ok(`org: ${org.name} (${org.email})`);
    const channels = await listChannels(org.id);
    if (!channels.length) bad('no channels connected in Buffer — connect your X profile first');
    for (const c of channels) {
      const isX = /twitter|^x$/i.test(String(c.service));
      console.log(`  ${isX ? '✓' : '·'} ${c.displayName || c.name} — service="${c.service}" id=${c.id}${c.isQueuePaused ? ' [QUEUE PAUSED]' : ''}`);
    }
    const x = channels.find((c) => /twitter|^x$/i.test(String(c.service)));
    x ? ok(`will publish to: ${x.displayName || x.name}`)
      : bad('no X/Twitter channel found in Buffer');
    if (x?.isQueuePaused) bad('that channel\'s queue is paused — unpause it in Buffer or nothing will publish');
  } catch (err) { bad(`Buffer: ${err.message}`); }
}

console.log(failures ? `\n${failures} problem(s) to fix.\n` : '\nAll good. Try: npm run dry\n');
process.exit(failures ? 1 : 0);
