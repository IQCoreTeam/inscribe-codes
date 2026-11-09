// The global feed's on-chain identity and the funded write flow into it.
// The feed is shared with iqlabs.dev (same db_root/table), so a launch recorded
// here lists on the board there and vice versa. Rows: { kind, body, who }.
import { contract, writer, utils } from "@iqlabs-official/solana-sdk";
import { estimateCost, getAccountRent, topUp, sweep } from "./burner.js";

export const DB_ROOT_LABEL = "iq6900-codein-feed-v1";
export const FEED_LABEL = "global-feed";

const programId = contract.createInstructionBuilder().programId;
const dbRootSeed = utils.toSeedBytes(DB_ROOT_LABEL);
const feedSeed = utils.toSeedBytes(FEED_LABEL);
export const feedTablePda = contract.getTablePda(contract.getDbRootPda(dbRootSeed, programId), feedSeed, programId);

// Write one feed row, funding-free: the burner must already hold enough.
// Referencing the owner's inventory PDA makes the same tx index under both the
// board (feed table) and the owner wallet's inventory (CLAUDE.md exception).
export function writeFeedRow({ connection, burner, row, owner, speed, onProgress }) {
  const userInvPda = contract.getUserInventoryPda(owner, programId);
  return writer.writeRow(connection, burner, dbRootSeed, feedSeed, row, false, [userInvPda], { speed, onProgress });
}

// The full funded lifecycle for one board row: estimate, top up from the
// user's wallet (one signature), write with one in-place retry, sweep leftover.
export async function inscribeRow({ connection, wallet, burner, kind, body, speed, onProgress, onRetry }) {
  const row = JSON.stringify({ kind, body, who: wallet.publicKey.toBase58() });
  const bytes = new TextEncoder().encode(row).length;
  const { total } = estimateCost(bytes, { accountRent: await getAccountRent(connection, burner.publicKey) });
  await topUp(connection, wallet, burner.publicKey, total);

  let sig;
  for (let attempt = 1; ; attempt++) {
    try {
      sig = await writeFeedRow({ connection, burner, row, owner: wallet.publicKey, speed, onProgress });
      break;
    } catch (e) {
      // One in-place retry: the burner keeps the funds, the SDK already
      // absorbs false expiries at the chunk level, and more passes would only
      // fight rate limits. The UI offers a manual retry beyond this.
      if (attempt >= 2) throw e;
      if (onRetry) onRetry(attempt);
      await topUp(connection, wallet, burner.publicKey,
        estimateCost(bytes, { accountRent: await getAccountRent(connection, burner.publicKey) }).total);
    }
  }

  await sweep(connection, burner, wallet.publicKey).catch((e) => console.warn("[feed] sweep skipped:", e && e.message));
  return { sig, row };
}

// A plain code-in write with no table row: a launched coin's Metaplex metadata
// JSON. The returned signature becomes the coin's on-chain uri path, so the
// JSON reassembles from Solana alone.
export async function inscribeMeta({ connection, wallet, burner, json }) {
  const bytes = new TextEncoder().encode(json).length;
  const { total } = estimateCost(bytes, { accountRent: await getAccountRent(connection, burner.publicKey) });
  await topUp(connection, wallet, burner.publicKey, total);
  const sig = await writer.codeIn({ connection, signer: burner }, json, "metadata.json", 0, "json");
  await sweep(connection, burner, wallet.publicKey).catch((e) => console.warn("[feed] meta sweep skipped:", e && e.message));
  return { sig };
}
