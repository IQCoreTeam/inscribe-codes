// Secondary-market trades. The backend builds the transaction on Tensor's
// program (list, buy, cancel) and returns it unsigned; the wallet itself signs
// and pays, there is no burner here. An item always trades in its collection's
// currency, which the backend decides.
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { call } from "../services/nft-backend.js";
import { base64ToBytes } from "./nft.js";
import { confirmOrCheck } from "./burner.js";
import { tokenBalance } from "./token.js";

// path: "/market/list" | "/market/buy" | "/market/delist". Returns the backend's
// reply with the decoded transaction; throws its error message otherwise.
export async function buildTrade(path, body) {
  const r = await call(path, body);
  if (r.status !== 200) throw new Error((r.json && r.json.error) || "market request failed (" + r.status + ")");
  return { ...r.json, tx: VersionedTransaction.deserialize(base64ToBytes(r.json.txV0)) };
}

// onSent fires once the wallet has signed and the transaction is on its way.
export async function sendTrade(connection, wallet, built, onSent) {
  const signed = await wallet.signTransaction(built.tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  onSent();
  // Tensor does not always return the expiry height; a blockhash lives ~150 blocks.
  const lastValid = built.lastValidBlockHeight || (await connection.getBlockHeight()) + 150;
  if (!(await confirmOrCheck(connection, sig, built.tx.message.recentBlockhash, lastValid))) throw new Error("the transaction was not confirmed; check your wallet before trying again");
  return sig;
}

// What the buyer holds of the listing's currency, in raw units (lamports for SOL).
export const buyerBalance = (connection, owner, mint) =>
  mint ? tokenBalance(connection, owner, new PublicKey(mint)) : connection.getBalance(owner);

// The real cost of a built SOL purchase when Tensor did not quote one: simulate
// it and read what leaves the buyer. null when it cannot be simulated (for
// instance the buyer cannot afford it).
export async function simulatedCost(connection, buyer, built) {
  const before = await connection.getBalance(buyer);
  const sim = await connection.simulateTransaction(built.tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: "base64", addresses: [buyer.toBase58()] } }).catch(() => null);
  const after = sim && !sim.value.err && sim.value.accounts && sim.value.accounts[0];
  return after ? before - after.lamports : null;
}
