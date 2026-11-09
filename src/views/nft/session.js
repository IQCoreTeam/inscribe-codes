// Shared wallet + burner session for every NFT page (launchpad, collection,
// single, studio). One signMessage derives the burner once per session.
import { esc, shortAddr } from "../../ui/fmt.js";

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

// The wallet pill every NFT page shows top-right; onChange repaints the page.
export function paintWalletPill(el, onChange) {
  const paint = () => {
    const a = addr();
    el.innerHTML = a ? "<span>" + esc(shortAddr(a)) + "</span>" : '<span class="lnk">Connect wallet</span>';
    if (!a) el.querySelector(".lnk").onclick = () =>
      connectWallet().then(() => { paint(); onChange && onChange(); }).catch((e) => alert(e.message));
  };
  paint();
  if (!addr()) restoreWallet().then((w) => { if (w) { paint(); onChange && onChange(); } });
}
