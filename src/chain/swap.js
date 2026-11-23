// SOL -> a stock token, through Jupiter's swap API (keyless, callable from the
// page). The wallet signs and pays; nothing here touches a burner.
//
// Jupiter has no exact-output route for these tokens, so a swap is quoted the
// other way round: the SOL to pay is fixed, and it is sized so that even after
// the slippage allowance at least the wanted amount arrives.
import { VersionedTransaction } from "@solana/web3.js";
import { base64ToBytes } from "./nft.js";
import { confirmOrCheck } from "./burner.js";

const API = "https://lite-api.jup.ag/swap/v1";
const SOL = "So11111111111111111111111111111111111111112";
export const SLIPPAGE_BPS = 50;

async function quote(outMint, lamports) {
  const r = await fetch(`${API}/quote?inputMint=${SOL}&outputMint=${outMint}&amount=${lamports}&slippageBps=${SLIPPAGE_BPS}`);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error((j && j.error) || "no swap route right now");
  return j;
}

// A quote whose guaranteed output (otherAmountThreshold) covers `want` raw units
// of outMint. inAmount is the SOL (lamports) the wallet pays, fixed at signing.
export async function quoteAtLeast(outMint, want) {
  let q = await quote(outMint, 20_000_000); // a probe, only for the rate
  for (let i = 0; i < 4; i++) {
    const lamports = Math.ceil((Number(q.inAmount) * want) / Number(q.otherAmountThreshold) * 1.002);
    q = await quote(outMint, lamports);
    if (Number(q.otherAmountThreshold) >= want) return q;
  }
  throw new Error("could not size the swap; try a slightly different amount");
}

// onSent fires once the wallet has signed and the swap is on its way.
export async function swap(connection, wallet, q, onSent) {
  const r = await fetch(`${API}/swap`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.swapTransaction) throw new Error((j && j.error) || "could not build the swap");
  const tx = VersionedTransaction.deserialize(base64ToBytes(j.swapTransaction));
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  onSent();
  if (!(await confirmOrCheck(connection, sig, tx.message.recentBlockhash, j.lastValidBlockHeight))) throw new Error("the swap was not confirmed; check your wallet before trying again");
  return sig;
}
