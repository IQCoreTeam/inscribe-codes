// Shared top nav (design/Home v5 Dark, Board v5, NFT Launchpad Flow v5), used
// by every view so the chrome stays identical. The cross-links are ?view=
// hrefs the router already intercepts. A view that needs a chain toggle paints
// the #nav_chain slot itself; the wallet slot is painted by paintWalletPill.
import { esc, shortAddr } from "./fmt.js";

const MID = { nft: "Every item lives on chain" };

export function nav(active) {
  const cross = active === "token"
    ? '<a class="navbtn2" href="?view=nft">NFT Launchpad &rarr;</a>'
    : '<a class="navbtn2" href="?view=token">Token markets &rarr;</a>';
  return `
<div class="navwrap">
  <div class="navbar">
    <div class="navgrp">
      <a class="navbtn" href="?view=home">&larr; Home</a>
      <a href="https://iqlabs.dev" target="_blank" rel="noopener" style="display:flex"><img class="navlogo" src="public/img/text_logo.webp" alt="IQLabs"></a>
      <span id="nav_chain"></span>
      ${active === "home" ? "" : cross}
    </div>
    <div id="nav_mid">${MID[active] || ""}</div>
    <div class="navstripwrap"><img class="navstrip" src="public/img/nav_strip.png" alt=""></div>
    <span id="nav_wallet"></span>
  </div>
</div>`;
}

// Wallet slot: connected = dotted pill with the short address (click = onPill,
// e.g. switch wallet); disconnected = Connect wallet button.
export function paintWalletPill(el, address, onConnect, onPill) {
  if (!el) return;
  el.innerHTML = address
    ? `<span class="navpill" title="${onPill ? "click to disconnect" : esc(address)}"><i></i>${esc(shortAddr(address))}</span>`
    : '<button class="btn2 navconnect">Connect wallet</button>';
  const b = el.querySelector(".navconnect");
  if (b) b.onclick = () => onConnect().catch((e) => alert(e.message));
  const p = el.querySelector(".navpill");
  if (p && onPill) p.onclick = onPill;
}
