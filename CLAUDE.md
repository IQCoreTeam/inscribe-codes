# inscribe-codes coding rules

These rules are binding for all code in this repo. When a rule and a shortcut conflict, the rule wins. Rule 5 and the SDK escalation rule both mean: say it, do not silently work around it.

## Core rules

1. Don't create meaningless wrappers with identical input and output.
2. If a feature is needed, scan all existing functions first and reuse as much as possible. Across the entire codebase, there must never be more than one function with the same purpose.
3. Don't create type variables that won't be reused; inline them whenever possible.
4. Don't introduce non-essential parameters. Only define parameters that are truly required.
5. Keep responsibilities clearly separated, and if the design or approach feels wrong, say so to the owner instead of building around it.

## SDK policy (the most important rule here)

All chain writes and reads go through the published SDKs, imported via the importmap. Never copy SDK-adjacent code from iq6900, never vendor SDK sources, never edit the SDKs from this repo.

Always use the high-level flows:

- `@iqlabs-official/solana-sdk`: `writer.codeIn`, `writer.writeRow`, `writer.createTable`, `reader.readCodeIn`, `reader.readTableRows`, `reader.fetchInventoryTransactions`, `reader.readUserInventoryCodeInFromTx`, `reader.readUserState`, `setRpcUrl` (array = failover pool).
- `@iqlabs-official/ethereum-sdk`: `writer.codeIn`, `writer.writeRow`, `writer.writeRowWithInventory`, `reader.readCodeIn`, `reader.readTableRows`, `reader.fetchInventoryTransactions`.

Low-level surfaces (contract ix builders, PDA derivation, chunking, session plumbing, tx send/retry internals, `toChunks`, `uploadLinkedList`, `readSendCodeChain`) are off limits by default. If a task genuinely cannot be done with the high-level flows, STOP before writing code and tell the owner (a) what is missing, (b) why the high-level call cannot do it, (c) the smallest low-level piece needed. That report is the point: a justified gap is usually an SDK issue to file, not something to assemble here.

Legitimate site-level code (not SDK duplication): the burner keypair derivation and its fund/sweep transfers, wallet discovery, HTTP clients for the nft backend / gateway / market data, calls to PumpPortal and the Pons factory, and all UI.

## Protocol constants that must match iqlabs.dev

- The burner derivation message string must be byte-identical to the one in iq6900 `assets/js/codein/burner.js`. Same string = same burner per wallet = shared inventory and no second account-init rent. Never invent a new one.
- Feed identifiers (db_root label, table, columns) are the live mainnet ones iq6900 uses. Read them from chain behavior, define them once in this repo.

## Structure rules

- A helper used by one caller lives next to that caller. It moves to a shared module only when a second caller appears. No `utils/` dumping ground.
- `src/views/` = route-level controllers only. `src/chain/` = wallet, burner, rpc, launch adapters. `src/services/` = HTTP clients. `src/ui/` = shared presentational pieces. A file that does not clearly belong to one of these is probably two files or wrongly conceived.
- No build step. Source is what ships. If something seems to need a bundler, raise it first (rule 5).

## Style

- No em-dash or en-dash anywhere (code, comments, UI copy, docs). No emoji in product UI; SVG for icons.
- Commits in English, imperative subject under 50 chars, no AI attribution lines.
- Comments only for constraints the code cannot show. No narration.
