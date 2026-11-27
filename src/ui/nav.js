// Shared top nav (design/Home v5 Dark, Board v5, NFT Launchpad Flow v5), used
// by every view so the chrome stays identical. The cross-links are ?view=
// hrefs the router already intercepts. A view that needs a chain toggle paints
// the #nav_chain slot itself; the wallet slot is painted by paintWalletPill.
import { esc, shortAddr } from "./fmt.js";

const MID = { nft: "Every item lives on chain" };

export function nav(active) {
  const cross = active === "token"
    ? '<a class="navbtn2" href="?view=nft" aria-label="NFT Launchpad">NFT Launchpad &rarr;</a>'
    : '<a class="navbtn2" href="?view=token" aria-label="Token markets">Token markets &rarr;</a>';
  return `
<div class="navwrap">
  <div class="navbar">
    <div class="navgrp">
      <a class="navbtn" href="?view=home">&larr; Home</a>
      <a class="navbrand" href="https://iqlabs.dev" target="_blank" rel="noopener"><img class="navlogo" src="public/img/text_logo.webp" alt="IQLabs"></a>
      <span id="nav_chain"></span>
      ${active === "home" ? "" : cross}
    </div>
    <div id="nav_mid">${MID[active] || ""}</div>
    <div class="navstripwrap"><img class="navstrip" src="public/img/nav_strip.png" alt=""></div>
    <span id="nav_wallet"></span>
  </div>
</div>`;
}

// A disclosure with native buttons keeps the same pointer and keyboard behavior
// on the home page, NFT screens, and either token chain.
let openWalletMenu = null;
let walletMenuId = 0;

document.addEventListener("pointerdown", (event) => {
  if (openWalletMenu && !openWalletMenu.el.contains(event.target)) openWalletMenu.close();
});
document.addEventListener("focusin", (event) => {
  if (openWalletMenu && !openWalletMenu.el.contains(event.target)) openWalletMenu.close();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openWalletMenu) {
    event.preventDefault();
    openWalletMenu.close(true);
  }
});

export function paintWalletPill(el, address, { connect, disconnect, list, activeId, blocked } = {}) {
  if (!el?.isConnected || !connect) return;
  openWalletMenu?.close();
  const home = el.id === "h_wallet";
  const label = address ? shortAddr(address) : "Connect wallet";
  const buttonClass = home ? "sm lnk home-wallet-button" : address ? "navpill" : "btn2 navconnect";
  const id = "wallet-actions-" + ++walletMenuId;
  el.innerHTML = `
    <button type="button" class="${buttonClass}" aria-label="${address ? "Wallet actions" : "Connect wallet"}" aria-controls="${id}" aria-expanded="false">
      ${address && !home ? '<i aria-hidden="true"></i>' : ""}${esc(label)}${address ? '<span class="wallet-chevron" aria-hidden="true">▾</span>' : ""}
    </button>
    <div class="wallet-menu" id="${id}" role="group" aria-label="Wallet options" hidden>
      <div class="wallet-options"></div>
      <p class="wallet-message" aria-live="polite" hidden></p>
    </div>`;
  const trigger = el.querySelector("button");
  const panel = el.querySelector(".wallet-menu");
  const options = el.querySelector(".wallet-options");
  const message = el.querySelector(".wallet-message");
  let pending = false;

  function status(text) {
    message.hidden = !text;
    message.textContent = text;
  }

  function close(focus = false) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (openWalletMenu?.el === el) openWalletMenu = null;
    if (focus && trigger.isConnected) trigger.focus();
  }

  function show() {
    openWalletMenu?.close();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    openWalletMenu = { el, close };
  }

  async function change(action) {
    if (pending) return;
    if (blocked?.()) return status("Finish the current wallet action first.");
    pending = true;
    status("Waiting for wallet…");
    try {
      await action();
      if (el.isConnected) el.querySelector("button")?.focus();
    } catch (error) {
      if (el.isConnected && trigger.isConnected) {
        if (panel.hidden) show();
        status(error?.message || "The wallet action failed. Try again.");
      }
    } finally {
      pending = false;
    }
  }

  async function pickWallet(initial = false) {
    if (pending) return;
    if (blocked?.()) return status("Finish the current wallet action first.");
    status("");
    pending = true;
    try {
      const wallets = await list();
      if (!trigger.isConnected || (!initial && panel.hidden)) return;
      if (initial && wallets.length === 1) {
        pending = false;
        return await change(() => connect(wallets[0].id));
      }
      options.innerHTML = '<div class="lab wallet-menu-title">Choose a wallet</div>';
      for (const wallet of wallets) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = wallet.name + (wallet.id === activeId ? " · connected" : "");
        button.onclick = () => change(() => connect(wallet.id));
        options.append(button);
      }
      if (!wallets.length) status("No compatible wallet found in this browser.");
      else if (address) status("To switch accounts, select the account in your wallet, then reconnect it here.");
      if (panel.hidden) show();
      options.querySelector("button")?.focus();
    } catch (error) {
      if (!trigger.isConnected) return;
      if (panel.hidden) show();
      status(error?.message || "Could not load wallets.");
    } finally {
      pending = false;
    }
  }

  trigger.onclick = () => {
    if (!panel.hidden) return close();
    if (pending) return;
    if (!address) return pickWallet(true);
    status("");
    options.innerHTML = `<div class="lab wallet-menu-title">Connected wallet</div>
      <div class="wallet-full-address">${esc(address)}</div>
      <button type="button" data-copy>Copy address</button>
      <button type="button" data-switch>Switch wallet</button>
      <button type="button" data-disconnect>Disconnect</button>`;
    options.querySelector("[data-copy]").onclick = async () => {
      try {
        await navigator.clipboard.writeText(address);
        status("Address copied.");
      } catch {
        status("Select the address above to copy it.");
      }
    };
    options.querySelector("[data-switch]").onclick = () => pickWallet();
    options.querySelector("[data-disconnect]").onclick = () => change(disconnect);
    show();
  };
}
