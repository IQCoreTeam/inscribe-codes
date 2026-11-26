// Asset viewer (design/NFT Launchpad Flow v5): status | image | on-chain data.
// Opens as a popup over
// whatever screen the item was clicked from (openModal); a direct ?asset= URL
// renders it as a full page (render). Gateway-first for speed; "run it from
// chain" re-reads everything from the chain alone and swaps in the bytes.
import { esc, shortAddr, fmtSol } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { nftMarkets, nftMarketOf } from "../../services/markets.js";
import { connect as rpcConnect, setRpc, hasOwnRpc, explorerTx } from "../../chain/rpc.js";
import { frame } from "./launchpad.js";
import { addr, paintWalletPill } from "./session.js";

const LEVEL = { common: 1, rare: 2, epic: 3, legendary: 4 };
const CLOSE = '<button type="button" class="wh-right wh-x nf-vclose" aria-label="Close">✕</button>';

function showViewerDialog(container, label, html) {
  const dialog = document.createElement("dialog");
  dialog.className = "nf-view-dialog";
  dialog.setAttribute("aria-label", label);
  dialog.innerHTML = html;
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest(".nf-vclose")) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  container.append(dialog);
  dialog.showModal();
  return dialog;
}

async function load(assetAddress) {
  const connection = rpcConnect();
  const { viewAssetViaGateway, readAsset } = await import("../../chain/asset.js");
  const [a, info] = await Promise.all([
    viewAssetViaGateway(connection, assetAddress).catch(async () => { const r = await readAsset(connection, assetAddress); r.imageUrl = r.imageDataUrl; return r; }).catch((e) => ({ error: e })),
    nft.assetInfo(assetAddress).catch(() => null),
  ]);
  // The active ask, if a seller posted one on any marketplace (listings are per collection).
  const listing = info && info.slug
    ? await nft.listings(info.slug).then((r) => (r.listings || []).find((l) => l.asset === assetAddress) || null).catch(() => null)
    : null;
  return { a, info, listing, readAsset };
}

// Listed: one Buy button to the venue that holds the ask (Manage if it is
// yours). Not listed: plain links to each marketplace.
function marketHtml(a, listing) {
  if (listing) {
    const m = nftMarketOf(listing.source);
    const mine = addr() && listing.seller === addr();
    return `<div class="nf-vsec"><div class="lab nf-vlab">Market</div>
      <div class="nf-vkv"><span>ask</span><b>${fmtSol(listing.price)} on ${esc(m.label)}</b><span>seller</span><b>${esc(shortAddr(listing.seller))}</b></div>
      <a class="btn nf-vbuy" href="${esc(m.item(a.asset))}" target="_blank" rel="noopener">${mine ? "Manage on" : "Buy on"} ${esc(m.label)} ↗</a></div>`;
  }
  return `<div class="nf-vsec"><div class="lab nf-vlab">Market</div><div class="cm">not listed right now</div>
    <div class="nf-vmk">${nftMarkets.map((m) => `<a class="btn2" href="${esc(m.item(a.asset))}" target="_blank" rel="noopener">${esc(m.label)}</a>`).join("")}</div></div>`;
}

// Shared layout for the collection popup and direct asset page.
function viewerHtml(a, info, listing, headerRight) {
  const rarity = info?.rarity;
  const tier = Object.hasOwn(LEVEL, rarity?.tier) ? rarity.tier : "";
  const idx = a.attributes && a.attributes.index != null ? a.attributes.index : info && info.index;
  const colName = (info && info.collectionName) || (a.metadata && a.metadata.collection && a.metadata.collection.name) || "";
  const std = (a.attributes && a.attributes.std) || "iqnft-0.1";
  const pips = [0, 1, 2, 3].map((i) => `<i class="${i < LEVEL[tier] ? "on" : ""}"></i>`).join("");
  const extra = ((a.metadata && a.metadata.attributes) || []).filter((x) => !["index", "inscription", "metadata", "std"].includes(x.trait_type));
  return `
<div class="win nf-win nf-viewer ${tier}">
  <div class="wh"><span class="nf-vtitle">${esc(a.name)}</span>${tier && tier !== "common" ? `<span class="nf-vchip">${esc(tier)}</span>` : ""}${headerRight}</div>
  <div class="nf-vgrid">
    <div class="nf-vcenter">
      <div class="nf-vframe ${tier}" id="nv_frame">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="${esc(a.name)}">` : '<span class="cm">no image pointer</span>'}<span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span></div>
      <div class="nf-vcap"><span>${idx != null ? "#" + idx : ""}</span><span>/img/C.png</span></div>
    </div>
    <div class="nf-vleft">
      <div><div class="lab nf-vlab">Name</div><div class="nf-vname">${esc(a.name)}</div><div class="cm" style="margin-top:2px">${esc(colName)}</div></div>
      ${tier ? `<div class="nf-vsec"><div class="lab nf-vlab">Rarity</div><div class="nf-vrar">${esc(tier)}${rarity.rank ? ` · rank ${rarity.rank} / ${rarity.total}` : ""}</div><div class="nf-vpips">${pips}</div></div>` : ""}
      <div class="nf-vsec"><div class="lab nf-vlab">Owner</div><div class="nf-vowner">${esc(shortAddr(a.owner))}</div></div>
      ${marketHtml(a, listing)}
      ${extra.length ? `<div class="nf-vsec"><div class="lab nf-vlab">Traits</div><div class="nf-vkv">${extra.map((x) => `<span>${esc(x.trait_type)}</span><b>${esc(String(x.value))}</b>`).join("")}</div></div>` : ""}
      <div class="nf-vsec" style="margin-top:auto"><div class="lab nf-vlab">Status</div>
        <div class="nf-vkv"><span>chain</span><b>solana</b><span>std</span><b>${esc(std)}</b><span>storage</span><b class="mint">inscribed</b><span>mutable</span><b>no</b></div></div>
    </div>
    <div class="nf-vright">
      <div><div class="lab nf-vlab">On chain</div>
        <div class="nf-vkv">
          <span>asset</span><b>${esc(shortAddr(a.asset))}</b>
          <span>collection</span><b>${a.collection ? esc(shortAddr(a.collection)) : "-"}</b>
          <span>image</span><b class="mint">${a.C ? esc(shortAddr(a.C)) : "-"}</b>
          <span>details</span><b class="mint">${a.M ? esc(shortAddr(a.M)) : "-"}</b>
          <span>link</span><b style="opacity:.8">gateway.iqlabs.dev/token-meta/${a.M ? esc(shortAddr(a.M)) : ""}</b>
        </div></div>
      <div class="nf-vsec"><div class="lab nf-vlab">Works without us</div>
        <div class="nf-vsteps"><div>01 the NFT stores the id of its details (M)</div><div>02 M names the image inscription (C); both are public Solana transactions</div><div>03 anyone with an RPC can read the image back</div></div></div>
      <div class="nf-vbtns lab">
        <a class="btn2" href="https://solscan.io/account/${esc(a.asset)}" target="_blank" rel="noopener">Solscan</a>
        ${a.C ? `<a class="btn2" href="${esc(explorerTx(a.C))}" target="_blank" rel="noopener">Image data</a>` : ""}
        ${a.M ? `<a class="btn2" href="${esc(explorerTx(a.M))}" target="_blank" rel="noopener">Details data</a>` : ""}
        <button type="button" class="btn2" id="nv_json">details json</button>
        <button class="btn2" id="nv_prove">Run it from chain now</button>
      </div>
    </div>
  </div>
</div>`;
}

// The chain proof and JSON open in their own dialogs.
function wire(scope, a, readAsset) {
  const prove = scope.querySelector("#nv_prove");
  if (prove) prove.onclick = () => openProve(a.asset, readAsset);
  const json = scope.querySelector("#nv_json");
  if (json) json.onclick = () => openJson(a.metadata);
}

// Small popup showing the on-chain metadata json, over the current screen.
function openJson(metadata) {
  showViewerDialog(document.body, "Details JSON", `<div class="win nf-win nf-jsonwin">
    <div class="wh"><span>details json</span>${CLOSE}</div>
    <pre class="nf-json" tabindex="0">${esc(JSON.stringify(metadata, null, 2))}</pre>
  </div>`);
}

// Small popup that rebuilds the image from the chain alone, for fun and as
// proof. A reader with no RPC of their own can paste one here; it is saved only
// in their browser (localStorage, via setRpc), never sent anywhere.
function openProve(assetAddress, readAsset) {
  const own = hasOwnRpc();
  const ov = showViewerDialog(document.body, "Read NFT from chain", `<div class="win nf-win nf-provewin">
    <div class="wh"><span>run it from chain</span>${CLOSE}</div>
    <div class="nf-provebody">
      <div class="cm">No gateway, no server: read the image straight off Solana.</div>
      <label class="nf-prpc"><span class="lab nf-vlab">Your RPC${own ? "" : " (optional)"}</span>
        <input id="nv_rpc" placeholder="https://your-rpc.example" autocomplete="off" spellcheck="false">
        <span class="cm">${own ? "leave blank to use your saved RPC. saved in this browser only." : "the public default keeps no old history; paste one that does for the full read. saved in this browser only."}</span>
      </label>
      <button class="btn" id="nv_prun">Run</button>
      <div class="cm nf-pstat" id="nv_pstat"></div>
      <div class="nf-pimg" id="nv_pimg"></div>
    </div>
  </div>`);
  const run = ov.querySelector("#nv_prun");
  const stat = ov.querySelector("#nv_pstat");
  run.onclick = async () => {
    run.disabled = true;
    const url = ov.querySelector("#nv_rpc").value.trim();
    if (url) setRpc(url);
    stat.textContent = "reading...";
    try {
      const r = await readAsset(rpcConnect(), assetAddress, (s) => { stat.textContent = "reading " + s + "..."; });
      stat.textContent = r.imageDataUrl ? "recovered from chain alone ✓" : "metadata recovered from chain ✓";
      if (r.imageDataUrl) ov.querySelector("#nv_pimg").innerHTML = `<img src="${r.imageDataUrl}" alt="">`;
    } catch (e) {
      stat.textContent = /not found on this RPC/.test(e.message)
        ? "this RPC keeps no old history. paste one that does and retry. the data IS on chain: use the tx links."
        : "chain read failed: " + e.message;
    }
    run.disabled = false;
  };
}

// Full page, for a direct ?view=nft&asset= URL.
export async function render(root, assetAddress) {
  const body = frame(root, '<div class="nf-note">reading the asset from chain...</div>');
  body.closest(".nf-page").classList.add("nf-view-page");
  paintWalletPill(root.querySelector("#nav_wallet"));
  const { a, info, listing, readAsset } = await load(assetAddress);
  if (!body.isConnected) return;
  if (a.error) { body.innerHTML = '<div class="nf-note">could not read ' + esc(assetAddress) + ": " + esc(a.error.message) + "</div>"; return; }
  const back = `<a class="wh-right wh-x nf-vback" href="${info && info.slug ? "?view=nft&c=" + esc(info.slug) : "?view=nft"}">${info && info.slug ? "← collection" : "← launchpad"}</a>`;
  body.innerHTML = `<div class="nf-stack">${viewerHtml(a, info, listing, back)}</div>`;
  wire(body, a, readAsset);
}

// Popup over the current screen. Closing just removes the overlay, so the page
// underneath (market, my nfts, a collection) is exactly where it was.
export async function openModal(assetAddress) {
  const modal = document.querySelector("#nf_modal");
  if (!modal) return;
  const overlay = showViewerDialog(modal, "NFT viewer", `<div class="win nf-win nf-viewer">
    <div class="wh"><span>NFT</span>${CLOSE}</div>
    <div class="nf-note" role="status">reading the asset from chain...</div>
  </div>`);

  const { a, info, listing, readAsset } = await load(assetAddress);
  if (!overlay.open || !overlay.isConnected) return;
  if (a.error) {
    overlay.querySelector(".nf-note").textContent = "could not read " + assetAddress + ": " + a.error.message;
    return;
  }
  overlay.setAttribute("aria-label", a.name);
  overlay.innerHTML = viewerHtml(a, info, listing, CLOSE);
  overlay.querySelector(".nf-vgrid").tabIndex = 0;
  overlay.querySelector(".nf-vclose").focus({ preventScroll: true });
  wire(overlay, a, readAsset);
}
