// Solana wallet state is shared by the home, NFT and token views.
import { paintWalletPill as paintNavWallet } from "../../ui/nav.js";
import { current, wallets, restore, connect, disconnect } from "../../chain/wallets.js";

export { current as wallet, connect as connectWallet, ensureBurner } from "../../chain/wallets.js";

export const addr = () => current()?.publicKey.toBase58() ?? null;

export function paintWalletPill(el, onChange, blocked) {
  if (!el) return;
  const changed = () => {
    if (!el.isConnected) return;
    paint();
    onChange?.();
  };
  const paint = () => paintNavWallet(el, addr(), {
    list: wallets,
    activeId: current()?.id,
    connect: async (id) => { await connect(id); changed(); },
    disconnect: async () => { await disconnect(); changed(); },
    blocked,
  });
  paint();
  if (!addr()) restore().then((wallet) => { if (wallet) changed(); });
}
