// The deterministic burner wallet and its funding economics. One fixed-message
// wallet signature derives the same keypair every time (and the SAME keypair
// iqlabs.dev derives: the message below is a cross-site protocol constant, so
// the one-time account-init rent is paid once per user, ever). The user's
// wallet signs only funding transfers; the burner signs everything else.
//
// The signature is key material. Never log or transmit it.
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { contract, constants } from "@iqlabs-official/solana-sdk";

const DERIVE_MESSAGE =
  "IQ6900 code-in burner v1. Sign to unlock your inscription wallet. This costs nothing and never leaves your browser.";

export async function deriveBurner(signMessage) {
  const signature = await signMessage(new TextEncoder().encode(DERIVE_MESSAGE));
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", signature));
  return Keypair.fromSeed(seed);
}

const TX_FEE = 5000; // lamports per signature
const CHUNK_BYTES = 3600; // v1 chunk payload budget (SDK CHUNK_SIZE_V1)
const SESSION_RENT = 1545120; // session PDA rent budget; overshoot sweeps back
const INIT_RENT = 69307680; // pre-quote default for the one-time account init
// A system account may not sit at 0 < balance < rent-exempt minimum. The
// burner (fee payer) reserves this floor up front and the funding wallet must
// keep it after the transfer; both are rejected in preflight otherwise.
const RENT_FLOOR = 900000;
const RENT_MIN = 890880;
// Headroom for fee variance and orphaned retry sessions; swept back after.
const MARGIN = 10000000;

// On-chain write fee charged by the program at finalize, per upload method
// (verified against mainnet transfers): direct 0.001, linked-list 0.003,
// session (10+ chunks) 0.005 SOL. A single chunk near the 3.6KB cap can still
// overflow the 3.4KB inline budget and fall to the linked list, so only
// clearly-inline sizes get the direct fee.
const writeFee = (chunks, byteLength) =>
  chunks >= 10 ? 5000000 : chunks === 1 && byteLength <= 3000 ? 1000000 : 3000000;

export function estimateCost(byteLength, { accountRent = INIT_RENT } = {}) {
  const chunks = Math.max(1, Math.ceil(byteLength / CHUNK_BYTES));
  const network = (chunks + 2) * TX_FEE; // chunks + create-session + finalize
  const codeInFee = writeFee(chunks, byteLength);
  const rent = SESSION_RENT + accountRent;
  return { chunks, network, codeInFee, rent, total: network + codeInFee + rent + RENT_FLOOR + MARGIN };
}

// Quote only the missing or undersized inscription accounts, so a returning
// user's funding popup asks for the real amount instead of the init worst case.
export async function getAccountRent(connection, publicKey) {
  const accounts = [
    [contract.getCodeAccountPda(publicKey), constants.CODE_ACCOUNT_SPACE],
    [contract.getUserInventoryPda(publicKey), constants.USER_INVENTORY_SPACE],
    [contract.getUserPda(publicKey), 8 + 32 + 4 + 1000 + 4 + 90 + 8],
  ];
  const existing = await connection.getMultipleAccountsInfo(accounts.map(([address]) => address));
  const rents = await Promise.all(accounts.map(async ([, size], i) => {
    const account = existing[i];
    if (account && !account.owner.equals(contract.PROGRAM_ID)) throw new Error("unexpected inscription account owner");
    if (account && account.data.length >= size) return 0;
    const rent = await connection.getMinimumBalanceForRentExemption(size);
    return Math.max(0, rent - ((account && account.lamports) || 0));
  }));
  return rents.reduce((total, rent) => total + rent, 0);
}

// Fund the burner up to `target`, sending only the shortfall. The user signs
// this one transfer. An expired transfer can never land, so a fresh-blockhash
// retry cannot double-spend, and the shortfall is recomputed each attempt.
export async function topUp(connection, wallet, burnerPubkey, target) {
  if ((await connection.getBalance(burnerPubkey)) >= target) return;
  const walletBal = await connection.getBalance(wallet.publicKey);
  const need = target - (await connection.getBalance(burnerPubkey));
  if (walletBal < need + TX_FEE + RENT_MIN) {
    throw new Error(
      "insufficient SOL in your wallet: need ~" + ((need + TX_FEE + RENT_MIN) / 1e9).toFixed(4) +
      " SOL (~0.0009 of it must stay in your wallet for rent), have " + (walletBal / 1e9).toFixed(4) +
      " SOL. fund the connected wallet and retry.",
    );
  }
  const expiredTwice = () => new Error("funding transfer expired twice (slow wallet approval or congested RPC). nothing was spent; retry, or add your own RPC.");
  for (let attempt = 0; ; attempt++) {
    const shortfall = target - (await connection.getBalance(burnerPubkey));
    if (shortfall <= 0) return;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.publicKey }).add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: burnerPubkey, lamports: shortfall }),
    );
    const signed = await wallet.signTransaction(tx);
    let sig;
    try { sig = await sendRaw(connection, signed); }
    catch (e) {
      // The blockhash can expire BEFORE the send while the approval popup sits
      // open; preflight then reports "Blockhash not found" - same harmless expiry.
      if (!/blockhash not found/i.test(String(e && e.message))) throw e;
      if (attempt >= 1) throw expiredTwice();
      continue;
    }
    const landed = await confirmOrCheck(connection, sig, blockhash, lastValidBlockHeight);
    if (landed || (await connection.getBalance(burnerPubkey)) >= target) return;
    if (attempt >= 1) throw expiredTwice();
  }
}

// Confirm, but do not trust "block height exceeded" blindly: on congested
// public RPCs the tx frequently lands anyway, so poll before giving up.
export async function confirmOrCheck(connection, sig, blockhash, lastValidBlockHeight) {
  try {
    const result = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (result.value.err) throw new Error("transfer " + sig + " failed: " + JSON.stringify(result.value.err));
    return true;
  } catch (e) {
    if (!e || e.name !== "TransactionExpiredBlockheightExceededError") throw e;
    for (let i = 0; i < 5; i++) {
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
        if (st.err) throw new Error("transfer " + sig + " failed: " + JSON.stringify(st.err));
        return true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }
}

// Fold preflight simulation logs into the thrown error so the UI shows the
// real on-chain cause, not just "simulation failed".
async function sendRaw(connection, signed) {
  try {
    return await connection.sendRawTransaction(signed.serialize());
  } catch (e) {
    let logs = e && e.logs;
    if (!logs && e && typeof e.getLogs === "function") { try { logs = await e.getLogs(connection); } catch (err) {} }
    if (logs && logs.length) e.message = (e.message || "send failed") + " | logs: " + logs.join(" ; ");
    throw e;
  }
}

// Refund the burner's leftover to the wallet. Best-effort callers catch: an
// inscription already on-chain must never surface a sweep hiccup as failure.
export async function sweep(connection, burner, to) {
  const balance = await connection.getBalance(burner.publicKey);
  if (balance <= TX_FEE) return 0;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: burner.publicKey }).add(
    SystemProgram.transfer({ fromPubkey: burner.publicKey, toPubkey: to, lamports: balance - TX_FEE }),
  );
  tx.sign(burner);
  const sig = await sendRaw(connection, tx);
  if (!(await confirmOrCheck(connection, sig, blockhash, lastValidBlockHeight))) {
    throw new Error("refund transfer " + sig + " was not confirmed; check its status before retrying");
  }
  return balance - TX_FEE;
}
