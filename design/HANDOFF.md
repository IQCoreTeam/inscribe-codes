# inscribe.codes design handoff

Design mockups exported from Claude Design (canvas "Inscribe.codes 토큰 런치 마이그레이션").
Each `*.dc.html` is one screen: plain HTML/CSS plus a small template layer
(`{{ var }}` bindings, `<sc-if>` / `<sc-for>` blocks, and a `<script type="text/x-dc">`
component whose `renderVals()` returns the bound values). Read them as the visual + copy
spec, not as production code.

## Current (v5) screens — the ones to implement
- `Home v5 Dark.dc.html` — entry. Nav, hero (image-slot), RECENT ticker, two doors
  (NFT.EXE / TOKEN_LAUNCH.EXE), Top 3 collections / Top 3 tokens, related links.
  `?view=nft` embeds NFT Launchpad Flow v5, `?view=token` embeds Board v5.
- `NFT Launchpad Flow v5.dc.html` — NFT side: Collections / Market / My NFTs tabs,
  Activity feed, collection page (buyer flow), item viewer, listing, launch wizard
  (6 steps, ends in "Deploying. Keep this tab open…").
- `Board v5.dc.html` — Token side. Main screen = Markets (pump.fun-style cards; click → chart modal
  with Go to pump.fun / Trade on PumpSwap / dexscreener by chain + graduation).
  "Launch a token" opens a layer: Step 1 pick Text / ASCII / Image / File / My inscriptions
  (dotted-frame tabs, per-type title + illustration) → inscribe modal (Pay → Writing to chain → auto-advance)
  → Step 2 name it and launch → Launched. Has a Solana half (`isSol`) and a Robinhood half (`isHood`),
  same structure, accent #3fd24f vs #8dffa0.
- `Art Helper v5.dc.html` — items.exe step 3: generate art / hand-craft / upload folder.
- `Launch Menu Merge v3.dc.html` — launch_collection.exe 4-step wizard (DOS blue theme).

## Design language (v5)
- Background #060a07, text #e9eee8 / #c9d0c7, muted #737f74, accent green #3fd24f (#8dffa0 on Robinhood),
  CTA amber #ffb347 (hover #ffd27a) with dark text #1a1206.
- Fonts: 'Jersey 15' (body, falls back from MonoMEK), 'Silkscreen' 11px (labels, window headers),
  Terminal16 (fonts/terminal16.ttf) for big display numbers/titles, Alagard (fonts/alagard.ttf).
- Window chrome `.win`: 1px solid accent border + 1px dotted outline offset 3px.
  Header `.wh`: dotted radial-gradient pattern strip; spans sit on solid #060a07.
- Dotted key/value rows `.kv`, chips `.chip .live/.soon/.out/.down`, ASCII bars `[████░░] 71%`
  for bonding progress / writing progress / graduation.
- Typewriter effect on titles (`data-tty` or component-driven), discrete-step animations only
  (steps(1,end)), hover "flick" on cards/rows.

## Assets
- `img/` — logo (text_logo.webp), nav strip, step illustrations (step_*.png), launch_hero.png,
  placeholder thumbnails (top1-3, cov1-5). `fonts/` — alagard.ttf, terminal16.ttf.
- `.image-slots.state.json` — hero / NFT banner / token banner images dropped into image-slots
  (base64 webp), keyed h4_hero, h4_nft, h4_tok.
- `support.js`, `image-slot.js` — the Claude Design runtime; not needed in production.

## Older screens kept for reference
Home.dc.html, Home v4*.dc.html, Board.dc.html, Board Dark.dc.html, NFT Launchpad Flow.dc.html,
NFT Launchpad Flow Dark.dc.html, NFT Mobile Live.dc.html, Launch Menu Merge*.dc.html, CTA Options.dc.html.
