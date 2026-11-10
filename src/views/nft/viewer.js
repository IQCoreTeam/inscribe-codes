// Asset viewer (design/NFT Launchpad Flow v5): status | image | on-chain data,
// with the metadata json as a section in the same window. Opens as a popup over
// whatever screen the item was clicked from (openModal); a direct ?asset= URL
// renders it as a full page (render). Gateway-first for speed; "run it from
// chain" re-reads everything from the chain alone and swaps in the bytes.
import { esc, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { frame } from "./launchpad.js";
import { paintWalletPill } from "./session.js";

const LEVEL = { common: 1, rare: 2, epic: 3, legendary: 4 };

async function load(assetAddress) {
  const connection = rpcConnect();
  const { viewAssetViaGateway, readAsset } = await import("../../chain/asset.js");
  const [a, info] = await Promise.all([
    viewAssetViaGateway(connection, assetAddress).catch(async () => { const r = await readAsset(connection, assetAddress); r.imageUrl = r.imageDataUrl; return r; }).catch((e) => ({ error: e })),
    nft.assetInfo(assetAddress).catch(() => null),
  ]);
  return { a, info, connection, readAsset };
}

// One window: header (with headerRight = close X or back link), the 3-column
// grid, then the details-json section below the same frame.
function viewerHtml(a, info, headerRight) {
  const tier = (info && info.rarity && info.rarity.tier) || "common";
  const idx = a.attributes && a.attributes.index != null ? a.attributes.index : info && info.index;
  const colName = (info && info.collectionName) || (a.metadata && a.metadata.collection && a.metadata.collection.name) || "";
  const std = (a.attributes && a.attributes.std) || "iqnft-0.1";
  const pips = [0, 1, 2, 3].map((i) => `<i class="${i < (LEVEL[tier] || 1) ? "on" : ""}"></i>`).join("");
  const extra = ((a.metadata && a.metadata.attributes) || []).filter((x) => !["index", "inscription", "metadata", "std"].includes(x.trait_type));
  return `
<div class="win nf-win nf-viewer ${tier}">
  <div class="wh"><span>${esc(a.name)}</span>${tier !== "common" ? `<span class="nf-vchip">${esc(tier)}</span>` : ""}${headerRight}</div>
  <div class="nf-vgrid">
    <div class="nf-vleft">
      <div><div class="lab nf-vlab">Name</div><div class="nf-vname">${esc(a.name)}</div><div class="cm" style="margin-top:2px">${esc(colName)}</div></div>
      <div class="nf-vsec"><div class="lab nf-vlab">Rarity</div><div class="nf-vrar">${esc(tier)}${info && info.rarity && info.rarity.rank ? ` · rank ${info.rarity.rank} / ${info.rarity.total}` : ""}</div><div class="nf-vpips">${pips}</div></div>
      <div class="nf-vsec"><div class="lab nf-vlab">Owner</div><div class="nf-vowner">${esc(shortAddr(a.owner))}</div></div>
      ${extra.length ? `<div class="nf-vsec"><div class="lab nf-vlab">Traits</div><div class="nf-vkv">${extra.map((x) => `<span>${esc(x.trait_type)}</span><b>${esc(String(x.value))}</b>`).join("")}</div></div>` : ""}
      <div class="nf-vsec" style="margin-top:auto"><div class="lab nf-vlab">Status</div>
        <div class="nf-vkv"><span>chain</span><b>solana</b><span>std</span><b>${esc(std)}</b><span>storage</span><b class="mint">inscribed</b><span>mutable</span><b>no</b></div></div>
    </div>
    <div class="nf-vcenter">
      <div class="nf-vframe ${tier}" id="nv_frame">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="">` : '<span class="cm">no image pointer</span>'}<span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span></div>
      <div class="nf-vcap"><span>${idx != null ? "#" + idx : ""}</span><span>/img/C.png</span></div>
    </div>
    <div class="nf-vright">
      <div><div class="lab nf-vlab">On chain</div>
        <div class="nf-vkv" style="word-break:break-all;gap:5px 10px">
          <span>asset</span><b>${esc(shortAddr(a.asset))}</b>
          <span>collection</span><b>${a.collection ? esc(shortAddr(a.collection)) : "-"}</b>
          <span>image</span><b class="mint">${a.C ? esc(shortAddr(a.C)) : "-"}</b>
          <span>details</span><b class="mint">${a.M ? esc(shortAddr(a.M)) : "-"}</b>
          <span>link</span><b style="opacity:.8">gateway.iqlabs.dev/token-meta/${a.M ? esc(shortAddr(a.M)) : ""}</b>
        </div></div>
      <div class="nf-vsec"><div class="lab nf-vlab">Works without us</div>
        <div class="nf-vsteps"><div>01 the NFT stores the id of its details (M)</div><div>02 M names the image inscription (C); both are public Solana transactions</div><div>03 anyone with an RPC can read the image back</div></div>
        <div class="cm" id="nv_prove_s" style="margin-top:6px"></div></div>
      <div class="nf-vbtns lab">
        <a class="btn2" href="https://solscan.io/account/${esc(a.asset)}" target="_blank" rel="noopener">Solscan</a>
        ${a.C ? `<a class="btn2" href="${esc(explorerTx(a.C))}" target="_blank" rel="noopener">Image data</a>` : ""}
        ${a.M ? `<a class="btn2" href="${esc(explorerTx(a.M))}" target="_blank" rel="noopener">Details data</a>` : ""}
        <a class="btn2" href="https://magiceden.io/item-details/${esc(a.asset)}" target="_blank" rel="noopener">Magic eden</a>
        <button class="btn2" id="nv_prove" style="grid-column:1 / -1">Run it from chain now</button>
      </div>
    </div>
  </div>
  <div class="nf-vjson">
    <div class="nf-vjsonhead lab">details json</div>
    <pre class="nf-json">${esc(JSON.stringify(a.metadata, null, 2))}</pre>
  </div>
</div>`;
}

// The "run it from chain" proof, shared by the page and the popup.
function wire(scope, connection, assetAddress, readAsset) {
  const prove = scope.querySelector("#nv_prove");
  const status = scope.querySelector("#nv_prove_s");
  if (!prove) return;
  prove.onclick = async () => {
    prove.disabled = true;
    try {
      const r = await readAsset(connection, assetAddress, (s) => { status.textContent = "reading " + s + "..."; });
      status.textContent = r.imageDataUrl ? "recovered from chain alone ✓ (the image above is the recovered bytes)" : "metadata recovered from chain ✓";
      if (r.imageDataUrl) scope.querySelector("#nv_frame img").src = r.imageDataUrl;
    } catch (e) {
      status.textContent = /not found on this RPC/.test(e.message)
        ? "the default public RPC keeps no old tx history; set your own RPC (localStorage ic_rpc_mainnet-beta) and retry. the data IS on chain: open the tx links."
        : "chain read failed: " + e.message;
    }
    prove.disabled = false;
  };
}

// Full page, for a direct ?view=nft&asset= URL.
export async function render(root, assetAddress) {
  const body = frame(root, '<div class="nf-note">reading the asset from chain...</div>');
  paintWalletPill(root.querySelector("#nav_wallet"));
  const { a, info, connection, readAsset } = await load(assetAddress);
  if (!body.isConnected) return;
  if (a.error) { body.innerHTML = '<div class="nf-note">could not read ' + esc(assetAddress) + ": " + esc(a.error.message) + "</div>"; return; }
  const back = `<a class="wh-right wh-x" href="${info && info.slug ? "?view=nft&c=" + esc(info.slug) : "?view=nft"}">${info && info.slug ? "← collection" : "← launchpad"}</a>`;
  body.innerHTML = `<div class="nf-stack">${viewerHtml(a, info, back)}</div>`;
  wire(body, connection, assetAddress, readAsset);
}

// Popup over the current screen. Closing just removes the overlay, so the page
// underneath (market, my nfts, a collection) is exactly where it was.
export async function openModal(assetAddress) {
  const modal = document.querySelector("#nf_modal");
  if (!modal) return;
  const close = () => { modal.innerHTML = ""; document.removeEventListener("keydown", onEsc); };
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  modal.innerHTML = '<div class="nf-overlay" id="nv_overlay"><div class="nf-note">reading the asset from chain...</div></div>';
  document.addEventListener("keydown", onEsc);
  modal.querySelector("#nv_overlay").onclick = (e) => { if (e.target.id === "nv_overlay") close(); };

  const { a, info, connection, readAsset } = await load(assetAddress);
  const overlay = modal.querySelector("#nv_overlay");
  if (!overlay) return; // closed while loading
  if (a.error) { overlay.innerHTML = '<div class="nf-note">could not read ' + esc(assetAddress) + ": " + esc(a.error.message) + "</div>"; return; }
  const x = `<span class="wh-right wh-x nv-close" title="close" style="cursor:pointer">✕</span>`;
  overlay.innerHTML = viewerHtml(a, info, x);
  overlay.querySelector(".nv-close").onclick = close;
  wire(overlay, connection, assetAddress, readAsset);
}
