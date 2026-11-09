# inscribe.codes

Inscription-first launchpad for NFTs and tokens, split out of the iq6900 site. Every NFT and every token here starts as an inscription: the file itself written to the chain. No IPFS, no server, no takedown.

This repo is the new site. iq6900.com / iqlabs.dev keep the inscription board (Code In / HOOD IN) and link here for launching; this site links back to the board. The two repos deliberately do NOT share code (decision 2026-11-09): the engine modules are copied, not packaged.

## Site structure

The whole site is one page shell (ported from `design/Home v5 Dark.dc.html`) with three views routed by `?view=`:

```mermaid
flowchart LR
    subgraph IC["inscribe.codes"]
        HOME["HOME ?view=home
        hero + RECENT ticker
        two doors + top 3 x 2"]
        NFT["NFT ?view=nft
        collections / market / my nfts
        item viewer / listing"]
        WIZ["launch_collection.exe
        4-step wizard
        + art helper (generate / handcraft / folder)"]
        TOK["TOKEN ?view=token
        markets.exe cards + chart modal
        Solana and Robinhood halves"]
        LAY["launch-a-token layer
        step 1: text / ascii / image / file
        or MY INSCRIPTIONS picker
        step 2: name it, launch"]
        HOME -->|Make an NFT| NFT
        NFT -->|Launch a collection| WIZ
        HOME -->|Launch a token| TOK
        TOK -->|Launch a token| LAY
    end
    IQ["iqlabs.dev
    board.exe (global feed)
    code-in / hood-in viewer"]
    IQ -->|LAUNCH A TOKEN / VIEW IN MARKETS / MINT buttons| IC
    LAY -->|VIEW ON IQ BOARD| IQ
    NFT -->|inscription recovery links| IQ
```

## Architecture

```mermaid
flowchart TB
    subgraph SITE["inscribe.codes (static, vanilla ESM + importmap, Firebase hosting)"]
        HOMEV[home shell]
        NFTV[nft pages]
        TOKV[token board]
        ENG["codein engine modules
        copied from iq6900/assets/js/codein
        burner, inscribe, cost, feed, wallets,
        nft engine, image_compress, market,
        token_launch, pons_launch"]
        HOMEV --> ENG
        NFTV --> ENG
        TOKV --> ENG
    end
    ENG --> SSDK["solana-sdk (importmap, pin 0.3.7+)"]
    ENG --> ESDK["ethereum-sdk (importmap)"]
    ENG --> NFTBE["nft.iqlabs.dev backend
    reserve / mint / creator stage+deploy"]
    ENG --> GW["gateway.iqlabs.dev
    img, token-meta, table rows, user assets"]
    ENG --> PP["PumpPortal -> pump.fun"]
    ENG --> PONS["Pons factory (Robinhood)"]
    SSDK --> SOL[(Solana)]
    ESDK --> RH[(Robinhood chain)]
```

Shared state that crosses the two sites:

- The burner keypair is derived from one fixed wallet `signMessage` string. That string MUST stay byte-identical with iqlabs.dev so a user has ONE burner everywhere (inventory shows up in MY INSCRIPTIONS, and the ~0.05 SOL account init rent is never paid twice).
- `localStorage` checkpoints do NOT cross origins: an in-progress deploy started on iqlabs.dev cannot resume here. Launch flows move here wholesale, so this only matters during the cutover.

## Development plan

| Phase | Work | Notes |
| --- | --- | --- |
| 0 | Scaffold: repo, static shell, fonts, `?view=` routing, design port of the Home v5 Dark frame | this commit holds the design export under `design/` |
| 1 | Home: hero, RECENT ticker, top 3 collections (backend `/c`), top 3 tokens (markets data), live labels | real data, no mock rows |
| 2 | Token side (`Board v5`): markets cards + chart modal (port `market.js`), launch layer (port `token_launch.js` + `pons_launch.js` + `inscribe.js` modal), MY INSCRIPTIONS picker via gateway `/user/{wallet}/assets` | Solana + Robinhood in one page, theme switch |
| 3 | NFT side (`NFT Launchpad Flow v5` + `Art Helper v5` + `Launch Menu Merge v3`): move the nft modules (`nft_bridge, nft_launch, nft_studio, nft_create, nft.js, nft_asset, nft_net, nft_notify`) and reskin to the v5 dark language | mobile layout from `NFT Mobile Live` |
| 4 | Infra: Firebase project + `inscribe.codes` domain, backend CORS additions (nft backend `CORS_ORIGIN`, gateway), sitewide links | server env message for the backend operator |
| 5 | Launch, then the iq6900 cleanup below | redirects first, removals after |

## iq6900 / iqlabs.dev cleanup after this site deploys

| Area on the main site | Action |
| --- | --- |
| `?menu=nft`, `?menu=nft-create` routes | Redirect to inscribe.codes (links are already in the wild and inside on-chain metadata) |
| THE STACK: IQ NFT card | Point to inscribe.codes |
| Code-in viewer: MAKE IT A TOKEN | Replace the in-page launcher with a link to `?view=token`; then remove `token_launch.js` |
| Code-in viewer: MINT AS NFT (single) | Becomes a link to the NFT side here |
| HOOD IN: pons launcher | Replace with a link; then remove `pons_launch.js` |
| markets.exe | Moves here; the board keeps a VIEW IN MARKETS link |
| NFT modules (`nft_*.js`, launch pages, studio) | Remove from iq6900 once redirects are live |
| Keeps on iqlabs.dev | Code In board, HOOD IN board, inscription viewer, ascii maker, about/tokenomics, the inscribe engine for board posts (burner derivation untouched) |
| Backend | Add `https://inscribe.codes` to nft backend + gateway CORS; keep the iqlabs origins |

## Design source

`design/` is the export of the Claude Design canvas "Inscribe.codes 토큰 런치 마이그레이션". **`Home v5 Dark.dc.html` is the single source of truth**: it embeds `NFT Launchpad Flow v5` and `Board v5` and links the rest; every other file is an older iteration kept for reference. See `design/HANDOFF.md` for the v5 design language (colors, fonts, window chrome, typewriter rules).

Known export gap: Home v5 Dark links `Launch Menu Merge v4.dc.html`, which is not in the export; the latest exported wizard is v3.

## Decisions on record

- No shared package with iq6900. The SDK (`@iqlabs-official/solana-sdk`, `ethereum-sdk`) stays the only shared dependency; site glue is duplicated on purpose.
- Pin solana-sdk 0.3.7+ here (iq6900 still pins 0.3.6; 0.3.7 carries the writer-chunk filter fix).
- Burner derivation string identical across both sites, forever.
