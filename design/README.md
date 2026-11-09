# inscribe.codes

## v2 (current direction): Unifont / release-sheet language
Same features as v1, reskinned: UnifontEX bitmap 16px, #070807 ground, #bfe8bf / #7dff7f ink, 2px hard borders, no radius / blur / gif. Palette and key/sel styles come from the IQLabs Inscription Viewer design system.
- Home v2.dc.html, Board v2.dc.html, NFT Launchpad Flow v2.dc.html, NFT Mobile Live v2.dc.html, Art Helper v2.dc.html, Launch Menu Merge v2.dc.html (all cross-link to v2).
- v1 files below are kept untouched for reference.


Token launch site split out of the IQ6900 Website project. Logo + HOME link go to https://iqlabs.dev.

## Home (entry)
- Home.dc.html         landing: hero + two doors (nft.exe -> NFT Launchpad Flow, token_launch.exe -> Board) + top3 NFT collections + top3 tokens. "<- HOME" on Board and NFT pages comes back here.

## Token launch
- Board.dc.html        ONE page, both chains. SOLANA <-> ROBINHOOD CHAIN switch in the nav (cream vs green theme, remembered in localStorage). Left: token_launch.exe inline. Step 1 = TEXT / ASCII / IMAGE / FILE / MY INSCRIPTIONS (wallet-gated, scrollable inventory from inscribe.codes + iqlabs.dev, any kind selectable). One bottom button: CONNECT WALLET -> CONTINUE -> FUND (new inscription, fund/progress/done modal) or CONTINUE WITH <pick>. Step 2 = name + launch -> LAUNCHED. Right: markets.exe; click a token for chart.exe. Nav: NFT LAUNCHPAD.

## NFT launchpad (unchanged design, back-link "<- HOME" -> Home.dc.html)
- NFT Launchpad Flow.dc.html   desktop: collections / market / my nfts / nft.exe viewer / listing / launch modal
- NFT Mobile Live.dc.html      phone + tablet, live-ready
- Art Helper.dc.html           items.exe step 3: generate art / hand-craft 1-of-1 / upload folder
- Launch Menu Merge.dc.html    launch menu (token vs collection)

## Shared
- support.js, img/text_logo.webp

## Hand-offs
IQ site (iqlabs.dev) keeps board.exe (global inscription feed). Its LAUNCH A TOKEN / "make a new inscription instead" / VIEW IN MARKETS point here.
Inscribe modal done -> "VIEW ON IQ BOARD" -> https://iqlabs.dev. SDK / CLI card -> https://iqlabs.mintlify.app/docs-typescript.

## External assets
https://r2.iqlabs.dev/animeVid.gif, Google Fonts (Kode Mono, Archivo, Zen Dots), covers from dev-gateway.iqlabs.dev / i2c.seadn.io
