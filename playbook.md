# Reach playbook for X

`voice.md` decides how the posts sound. This file decides how they're shaped so X
actually shows them to people. It is fed to the model on every run, next to the voice
guide. Edit it when your own numbers (`npm run report`) say something works better.

## How X decides reach, and what that means for a post

- **The first hour decides most of it.** Early replies, reposts and dwell time push a
  post to more people. A post has to earn a stop within the first line.
- **Replies are weighted far above likes.** A post people want to answer beats one they
  just nod at. That means a real opinion, a specific claim, or a genuine question, but
  never a begged one.
- **External links cost reach.** Posts with links are shown to fewer people. Name the
  source in words ("Anthropic shipped…", "a new paper from Google DeepMind…") and keep
  links out.
- **Dwell time counts.** Short lines with line breaks get read to the end; one dense
  paragraph gets skimmed past.
- **Consistency beats bursts.** One solid post a day at the same time trains your
  audience and the algorithm better than five at once.

## The first line (the hook)

It has to stand alone and be under about 70 characters. It needs one of these:
- **A claim:** "Coding agents just got a lot cheaper to run."
- **A consequence:** "Your RAG pipeline might not need a vector DB anymore."
- **A surprise:** "The best open model this week isn't from a big lab."
- **A tension:** "Everyone's shipping agents. Almost nobody's shipping evals."
- **A concrete result:** "Canopy now renders 2,000-function repos without choking."

Avoid hooks that are only a topic ("Thoughts on the new Gemini release"), a
countdown ("Day 12"), or hype ("This changes everything").

## Shapes that get reach for dev audiences

**Take + why (the default)**
> Hook with the opinion.
> One or two lines on the concrete reason, from the news.
> One line on what it means for people building apps.

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
