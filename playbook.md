# Reach playbook for X

`voice.md` decides how the posts sound. This file decides how they're shaped so X
actually shows them to people. It is fed to the model on every run, next to the voice
guide. Edit it when your own numbers (`npm run report`) say something works better.

## Who it's for

Builders on X: developers and technical founders who ship products. Every post should
make sense to both. Name the real tech, and say what it changes for a product or a
business: cost, speed, risk, who wins.

## How X decides reach, and what that means for a post

From readings of X's open-sourced ranking code (2026). Rough weights, relative to a like:

| Action | Weight |
|---|---|
| A reply the author answers | ~150x |
| A reply, or a quote post | ~27x |
| A profile click that leads to engagement | ~24x |
| A bookmark | ~20x |
| A repost | 2x |
| A like | 1x |
| A mute or "show less" | about -150x |
| A report | about -740x |

- **Write for replies and bookmarks, not likes.** A stance someone could disagree with
  earns replies. Specifics worth keeping (the steps, the numbers, the tradeoff) earn
  bookmarks. A post that is only agreeable gets likes and nothing else.
- **Never rage-bait.** One mute cancels a lot of likes. Firm, never snarky; argue with
  ideas, never dunk on people or companies.
- **The first hour decides most of it.** A post has to earn a stop within the first line.
- **External links cost reach.** Posts with links are shown to fewer people. Name the
  source in words ("Anthropic shipped…", "a new paper from Google DeepMind…") and keep
  links out.
- **Dwell time counts.** Short lines with line breaks get read to the end; one dense
  paragraph gets skimmed past.
- **Space posts out.** A second post from the same author in one feed refresh counts
  about half, so the three daily posts go out hours apart, each on a different story.

## The first line (the hook)

It has to stand alone and be under about 70 characters. It needs one of these:
- **A claim:** "Coding agents just got a lot cheaper to run."
- **A consequence:** "Your RAG pipeline might not need a vector DB anymore."
- **A surprise:** "The best open model this week isn't from a big lab."
- **A tension:** "Everyone's shipping agents. Almost nobody's shipping evals."
- **A concrete result:** "Canopy now renders 2,000-function repos without choking."

Avoid hooks that are only a topic ("Thoughts on the new Gemini release"), a
countdown ("Day 12"), or hype ("This changes everything").

## What is getting reach with builders in 2026

- "What I tried and what happened", and "this worked, this didn't".
- Proof: a real number, a before and after, a concrete result.
- A contrarian take with a stated reason.
- One specific problem, solved step by step.
- The business side of AI: prices, margins, who gets squeezed, what happens to SaaS.

What stopped working: one-liners with no context, generic frameworks, hashtag stacks,
rage-bait, and AI-sounding posts with no point of view.

## Shapes that get reach

**Take + why (the default)**
> Hook with the opinion.
> One or two lines on the concrete reason, from the news.
> One line on what it means for people building products.

**Business of AI**
> Hook: the money consequence ("Your agent's supervisor might be your biggest line item.")
> The fact from the news, with its number.
> What it does to margins, pricing, or who wins.

**Worth saving**
> Hook: what changed.
> [thing to check or change]
> [thing to check or change]
> [optional third]

**Contrarian**
> Hook: the popular reading, turned ("SWE-bench scores are a bad reason to pick an agent.")
> The specific reason, from the source.
> What to do instead.

**What it actually changes**
> [Thing] shipped [specific capability].
> The part that matters: [consequence for builders].
> [Who should care / what to try or watch].

**Paper in plain words**
> New paper: [finding in one plain sentence].
> Why it matters if you ship software: [practical implication].

**Three things (roundup)**
> Hook line about the week.
> [item 1 in under 60 chars]
> [item 2]
> [item 3]

**I tried it (midweek, from real commits)**
> Hook: the result, the surprise, or the decision.
> What was tried or changed, concretely.
> The tradeoff or the lesson, in one line.

**Weekly recap (build in public)**
> Hook: the most interesting thing that happened in the week's work.
> Learned: [a specific gotcha or insight from the commits]
> Shipped: [a concrete thing, by name]
> Next: [what's in progress]
(Labels are optional. Use them only if they read naturally.)

## Rules that protect reach

- One idea per post. If it needs a thread, it's two posts.
- Specific beats general: model names, library names, numbers from the source.
- Plain words. If a sentence would work in a press release, rewrite it.
- End on the insight or a real question, never on "thoughts?" or "agree?".
- Zero hashtags is the default. One topic hashtag at most, never a stack.
- No emoji bullets, no 🚀, no 🧵, no ALL CAPS.
- Never fake a first-hand experience ("I tried X") when the source is news.

## After posting (the part automation can't do)

Reply to every reply in the first hour. The algorithm weights author replies heavily,
and it's where followers actually come from.
