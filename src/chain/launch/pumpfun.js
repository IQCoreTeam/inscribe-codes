// pump.fun launcher. PumpPortal trade-local returns the UNSIGNED create tx;
// the platform fee transfer is appended into that SAME message (atomic: the
// fee is only ever paid if the create lands), the fresh mint keypair signs,
// then the user's wallet signs and sends. Returns { mint, sig }.
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const PORTAL_URL = "https://pumpportal.fun/api/trade-local";
const FEE_WALLET = new PublicKey("5eCDJGbuS1k5ELso8h6fnMVEJpjmrCHoX1sS92Txa9Rh");
export const FEE_SOL = 0.069;
const PUMP_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const CREATE_V2_DISC = [0xd6, 0x90, 0x4c, 0xec, 0x5f, 0x8b, 0x31, 0xb4];

export async function launchOnPump({ connection, wallet, name, symbol, uri, devBuySol = 0, onStep = () => {} }) {
  if (!wallet || !wallet.publicKey) throw new Error("connect your Solana wallet before launching the token");
  const owner = wallet.publicKey;

  onStep("building the create transaction");
  const mintKp = Keypair.generate();
  const res = await fetch(PORTAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: owner.toBase58(),
      action: "create",
      tokenMetadata: { name, symbol, uri },
      mint: mintKp.publicKey.toBase58(),
      denominatedInSol: "true",
      amount: devBuySol,
      slippage: 10,
      priorityFee: 0.0005,
      pool: "pump",
    }),
  });
  if (!res.ok) throw new Error("pumpportal rejected the create (" + res.status + "): " + (await res.text()).slice(0, 200));
  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));

  // The create tx uses an address lookup table, so decompiling needs the
  // resolved table accounts, and the recompile passes them back so the message
  // stays within size.
  const lookups = [];
  for (const l of tx.message.addressTableLookups) {
    const info = await connection.getAddressLookupTable(l.accountKey);
    if (!info || !info.value) throw new Error("could not resolve the create tx lookup table " + l.accountKey.toBase58());
    lookups.push(info.value);
  }
  const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookups });

  // Holder rewards: pump's create_v2 takes trailing optional args PumpPortal
  // omits; appending is_cashback=false + creator_fee_bps=0 + is_holder_reward=
  // true flips the coin so fees stream to holders, permanently. The dev-buy
  // then needs the holder creator vault: bonding_curve.creator becomes
  // PDA("holder-rewards", mint), so the buy's creator_vault PDA derives from
  // that instead of the wallet. (Both verified by mainnet simulation.)
  const seed = (s) => new TextEncoder().encode(s);
  const holderCreator = PublicKey.findProgramAddressSync([seed("holder-rewards"), mintKp.publicKey.toBuffer()], PUMP_ID)[0];
  const holderVault = PublicKey.findProgramAddressSync([seed("creator-vault"), holderCreator.toBuffer()], PUMP_ID)[0];
  const walletVault = PublicKey.findProgramAddressSync([seed("creator-vault"), owner.toBuffer()], PUMP_ID)[0];
  let patched = false;
  for (const ix of msg.instructions) {
    const d = ix.data;
    if (ix.programId.equals(PUMP_ID) && d.length >= 8 && CREATE_V2_DISC.every((b, i) => d[i] === b)) {
      const d2 = new Uint8Array(d.length + 10); // +[0] +u64(0) +[1]
      d2.set(d);
      d2[d.length + 9] = 1;
      ix.data = d2;
      patched = true;
    }
    for (const k of ix.keys) if (k.pubkey.equals(walletVault)) k.pubkey = holderVault;
  }
  if (!patched) throw new Error("could not enable holder rewards: the create instruction did not match create_v2. launch aborted before any signature; retry.");

  msg.instructions.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: FEE_WALLET, lamports: Math.round(FEE_SOL * 1e9) }));
  const withFee = new VersionedTransaction(msg.compileToV0Message(lookups));
  withFee.sign([mintKp]);

  onStep("approve the transaction in your wallet");
  const sent = await wallet.signAndSendTransaction(withFee);
  const sig = (sent && sent.signature) || sent;

  onStep("confirming on solana");
  // Poll instead of confirmTransaction: PumpPortal picked the blockhash, and
  // polling survives RPC websocket hiccups.
  for (let i = 0; i < 40; i++) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      if (st.err) throw new Error("transaction failed on chain: " + JSON.stringify(st.err));
      return { mint: mintKp.publicKey.toBase58(), sig };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("the launch transaction did not confirm in time; check " + sig + " on an explorer before retrying");
}
