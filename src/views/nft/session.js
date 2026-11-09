// Shared wallet + burner session for every NFT page (launchpad, collection,
// single, studio). One signMessage derives the burner once per session.
import { paintWalletPill as paintNavWallet } from "../../ui/nav.js";

export const session = { wallet: null, burner: null };

let api = null;
const walletsApi = async () => (api ||= await import("../../chain/wallets.js"));

export async function restoreWallet() {
  const w = await (await walletsApi()).restore();
  if (w) session.wallet = w;
  return session.wallet;
}

export async function connectWallet() {
  session.wallet = await (await walletsApi()).connect();
  return session.wallet;
}

export async function ensureBurner() {
  if (session.burner) return session.burner;
  if (!session.wallet) throw new Error("connect your wallet first");
  const { deriveBurner } = await import("../../chain/burner.js");
  session.burner = await deriveBurner((m) => session.wallet.signMessage(m));
  return session.burner;
}

export const addr = () => (session.wallet ? session.wallet.publicKey.toBase58() : null);

// The nav wallet slot on every NFT page: silent restore of an approved wallet,
// then onChange repaints whatever the page gates on the wallet.
export function paintWalletPill(el, onChange) {
  const paint = () => paintNavWallet(el, addr(), () => connectWallet().then(() => { paint(); onChange && onChange(); }));
  paint();
  if (!addr()) restoreWallet().then((w) => { if (w) { paint(); onChange && onChange(); } });
}
