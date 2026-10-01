import { warn } from './util.js';
import { generateJSON } from './llm.js';

/*
 * Last check before a post goes out: catch an invented fact, a fake number, or a
 * technical claim that's just wrong — the kind of mistake that costs more credibility
 * than a skipped slot. Runs after the quality gate, on the scored candidates, in order.
 *
 * Grounded types (insight, question with a news block, bip, recap) are checked against
 * `context`, the exact source block the writer prompt was given. Ungrounded types
 * (tip, observation, a stack-only question) have no source block — those are checked
 * against well-established technical knowledge instead.
 */

const GROUNDED = new Set(['insight', 'question', 'bip', 'recap']);

export async function factCheck(text, cfg, { type, context } = {}) {
  const grounded = GROUNDED.has(type) && Boolean(context);

  const prompt = `You are a strict reviewer fact-checking one X post before it goes out
under a real developer's name. Be skeptical — a wrong or invented claim costs this
person more credibility than a post that never goes out.

=== THE POST ===
${text}

${grounded
    ? `=== SOURCE MATERIAL (the only facts this post is allowed to use) ===
${context}

Check every factual claim in the post — every number, name, feature, date, or
benchmark — against the source material above. Flag anything the post states as fact
that is not actually supported by that material.`
    : `This post makes a technical claim about long-stable, well-established developer
knowledge, not tied to any news item. Check it against what is actually true. Flag
anything that is wrong, outdated, version-specific, or not a real function/flag/setting.`}

Also flag, regardless of the above:
- an invented first-hand experience or personal story the author could not actually have had
- a fake or invented number, statistic, or price
- anything else that would embarrass a developer if it turned out to be wrong

Return ONLY JSON, no prose, no code fence:
{"ok":true|false,"problems":["short problem description", ...]}
ok is true only when problems is empty.`;

  try {
    const { parsed } = await generateJSON(prompt, cfg, 'writer');
    const problems = Array.isArray(parsed?.problems) ? parsed.problems.map((p) => String(p)) : [];
    return { ok: Boolean(parsed?.ok) && !problems.length, problems };
  } catch (e) {
    warn(`fact-check unavailable (${e.message})`);
    // A tip is a flat factual claim with no source to fall back on if the checker is
    // down, so it must not go out unchecked. Every other type degrades gracefully.
    if (type === 'tip') return { ok: false, problems: ['fact-check unavailable'] };
    return { ok: true, problems: [], skipped: true };
  }
}
