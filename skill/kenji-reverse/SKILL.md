---
name: kenji-reverse
description: Reverse engineer any funnel, landing page, checkout flow or web app from real evidence, then rebuild it as your own. Use when the user says "reverse engineer", "how does this funnel work", "break down this offer", "what is this site running", "clone this flow", or pastes a competitor URL and asks how it makes money.
---

# kenji-reverse

You are reverse engineering a live product for the user. Every claim you make must point at evidence you captured: a network call, a saved response body, a screenshot, an archived page or a tag container. If you can't prove it, say it's a guess.

The CLI is `kr` (`node <repo>/bin/kr.mjs`). Evidence lands in `./evidence` (override with `KR_DIR`).

## Rules

1. **Never buy, book or submit.** Don't enter payment details, don't confirm bookings, don't submit opt-in forms with real data. Clicking a time slot or opening a checkout page is fine; finishing it is not.
2. **Evidence first.** Run `kr net` after every important click and quote the call that proves each finding.
3. **Rebuild in the user's words and brand.** Never copy the target's logos, copy or images into the rebuild.
4. **Dead site? Use the archive.** `kr wayback` lists archived pages; `kr wayback <url> --get <timestamp>` pulls one.

## Workflow

### 1. Observe
```
kr start <url>          # opens Chrome and starts recording every network call
kr look                 # headings, prices, buttons, forms, links, trackers
kr shot                 # screenshot
```

### 2. Walk the flow like a visitor
```
kr click "Get started"  # real mouse click by visible text
kr look
kr net --api            # only the XHR/fetch calls: this is where the logic lives
```
Repeat for each step. Open saved bodies (`evidence/bodies/*.json`) to read the actual data.

### 3. Decode
- **APIs:** for each call, write down what it sends, what it gets back and what the page does with it. Decode odd formats (packed timestamps, encoded state in the URL) and prove the decode by matching it to what's on screen.
- **Money:** prices on each step, order bumps, upsells, downsells, payment provider.
- **Tracking:** `kr tags` lists pixels and decodes Google Tag Manager containers, which often reveal funnel steps and page paths that aren't linked anywhere.
- **History:** `kr wayback <domain>` shows how long the funnel has run and how it changed.

### 4. Report
Write `funnel-map.html` (or `how-it-works.md`): each step, why it converts, and the evidence for it. End with "what we'd copy" and "what we'd do better".

### 5. Rebuild
Build the working version the user asked for (a page, a booking flow, a quiz) in their brand. Open it with `kr goto file:///...` and click through it once to prove it works.

When done: `kr stop`.

Built by KenjiAI. Want this done for your business? https://kenjiai.com
