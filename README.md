# kenji-reverse

**Reverse engineer any funnel, page or web app. Then build your own.**

Point your AI agent at a competitor's funnel and it walks through it like a visitor, records every network call, decodes the pixels and tag containers, digs up dead funnels from the Web Archive, and hands you a map of how the thing makes money. Then it builds your version.

Works with Claude Code out of the box. Zero dependencies: Node 22+ and Google Chrome.

## What it found in testing

- **A 6 year old funnel from a top marketer**, even though the live site is gone: $5.60 front end, email-first popup, $37 order bump, $297 one time offer, pixel events on every step. Rebuilt from archived pages plus the still-live Tag Manager container.
- **An open source booking page**: how the time slots are packed (one call, start time in minutes then gaps), how a slot gets held while you type. Then it built a working branded booking page in about 6 minutes.

## Install

```bash
git clone https://github.com/yousiful/kenji-reverse
cd kenji-reverse
node bin/kr.mjs            # prints the commands
```

Add the skill to Claude Code:

```bash
# macOS / Linux
cp -r skill/kenji-reverse ~/.claude/skills/
# Windows (PowerShell)
Copy-Item -Recurse skill\kenji-reverse $HOME\.claude\skills\
```

Then just ask: *"Use kenji-reverse to figure out how this funnel works: https://..."*

## Commands

| Command | What it does |
|---|---|
| `kr start [url] [--headless]` | Open Chrome and record every network call |
| `kr goto <url>` | Navigate |
| `kr click <visible text>` | Real mouse click on the element with that text |
| `kr type <css> <text>` | Type into a field |
| `kr look` | Headings, prices, buttons, forms, links, trackers |
| `kr text` | Visible page text |
| `kr shot [name] [--full]` | Screenshot |
| `kr net [--api] [--grep s]` | Every call the page made, with saved response bodies |
| `kr eval <js>` | Run JavaScript in the page |
| `kr tags [url]` | Pixels + Google Tag Manager container decode |
| `kr wayback <url> [--get ts]` | Archived pages for dead or changed funnels |
| `kr stop` | Close Chrome and the recorder |

Everything is saved to `./evidence` so every claim can be checked.

## Rules it follows

It never buys, books or submits forms with real data, and it never copies the target's logos or copy into your rebuild. It learns how something works, then builds yours.

## Need it done for you?

We build funnels, ads and AI follow-up for businesses at **[KenjiAI](https://kenjiai.com)**. Comment, open an issue, or [book a call](https://kenjiai.com/growth-quiz).

MIT License.
