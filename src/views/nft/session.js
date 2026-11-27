// Solana wallet state is shared by the home, NFT and token views.
import { paintWalletPill as paintNavWallet } from "../../ui/nav.js";
import { current, wallets, restore, connect, disconnect, onWalletsChanged } from "../../chain/wallets.js";

import { chooseWallet } from "../../ui/wallet-picker.js";

export { current as wallet, ensureBurner } from "../../chain/wallets.js";

export function connectWallet() {
  return chooseWallet({ list: wallets, connect, activeId: current()?.id, subscribe: onWalletsChanged });
}

export const addr = () => current()?.publicKey.toBase58() ?? null;

export function paintWalletPill(el, onChange, blocked) {
  if (!el) return;
  const changed = () => {
    if (!el.isConnected) return;
    paint();
    onChange?.();
  };
  const paint = () => paintNavWallet(el, addr(), {
    connect: async () => { if (await connectWallet()) changed(); },
    disconnect: async () => { await disconnect(); changed(); },
    blocked,
  });
  paint();
  if (!addr()) restore().then((wallet) => { if (wallet) changed(); });
}
