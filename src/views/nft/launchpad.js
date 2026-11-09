// NFT side (NFT Launchpad Flow v5). This module is the sub-router and the
// launchpad home (COLLECTIONS / MY NFTS tabs + activity feed); the collection
// page, the asset viewer, the single mint and the launch wizard are their own
// modules, dispatched on the query params:
//   ?view=nft            -> this home
//   ?view=nft&c=<slug>   -> collection page
//   ?view=nft&asset=<a>  -> asset viewer
//   ?view=nft&single=<C> -> single 1/1 mint
import { typeLabels } from "../../ui/tty.js";
import { esc, fmtSol, fmtWhen, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { imgUrl } from "../../services/gateway.js";
import { addr, paintWalletPill } from "./session.js";

export async function mount(root) {
  const q = new URLSearchParams(location.search);
  if (q.get("c")) return (await import("./collection.js")).render(root, q.get("c"));
  if (q.get("asset")) return (await import("./viewer.js")).render(root, q.get("asset"));
  if (q.get("single")) return (await import("./single.js")).render(root, q.get("single"));
  return home(root);
}

// Shared page frame: nav + wallet pill. Every NFT page calls this first.
export function frame(root, bodyHtml) {
  root.innerHTML = `
<div style="max-width:1280px;margin:0 auto;padding:20px 16px 80px">
  <div class="sm" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      <a href="?view=home">&larr; HOME</a><a href="?view=nft">COLLECTIONS</a><a href="?view=token">TOKEN LAUNCH</a>
      <a href="https://iqlabs.dev/?menu=codein" target="_blank" rel="noopener">IQ BOARD</a>
    </div>
    <span id="nf_wallet"></span>
  </div>
  <div id="nf_body">${bodyHtml}</div>
</div>
<div id="nf_modal"></div>`;
  typeLabels(root);
  return root.querySelector("#nf_body");
}

let tab = "collections";

async function home(root) {
  frame(root, `
  <div class="win">
    <div class="wh">
      <span data-tty>nft.exe</span>
      <span style="display:flex;gap:8px">
        <button class="chip nf_tab" data-tab="collections">COLLECTIONS</button>
        <button class="chip nf_tab" data-tab="mine">MY NFTS</button>
      </span>
    </div>
    <div style="display:flex;gap:18px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--acc);flex-wrap:wrap">
      <div style="flex:1 1 260px;min-width:0">
        <div class="hero" style="font-size:22px" data-tty>Fully onchain NFT collections.</div>
        <div class="sm" style="margin-top:4px;font-size:13px;line-height:1.6">Every item's image and metadata are inscriptions; the NFT just points at them. Launch your own collection or mint from one.</div>
      </div>
      <button class="cta" id="nf_launch">&rarr; Launch a collection</button>
    </div>
    <div id="nf_tabbody" style="padding:14px"><span class="sm">loading...</span></div>
  </div>
  <div class="win" style="margin-top:20px">
    <div class="wh"><span data-tty>Activity</span></div>
    <div id="nf_activity" style="padding:10px 14px" class="sm">loading recent mints...</div>
  </div>`);

  paintWalletPill(root.querySelector("#nf_wallet"), () => { if (tab === "mine") paintTab(root); });
  for (const b of root.querySelectorAll(".nf_tab")) {
    b.classList.toggle("live", b.dataset.tab === tab);
    b.onclick = () => { tab = b.dataset.tab; for (const x of root.querySelectorAll(".nf_tab")) x.classList.toggle("live", x.dataset.tab === tab); paintTab(root); };
  }
  root.querySelector("#nf_launch").onclick = async () => (await import("./studio.js")).open(root);

  paintTab(root);
  loadActivity(root).catch(() => { const el = root.querySelector("#nf_activity"); if (el) el.textContent = "activity unavailable right now"; });
}

async function paintTab(root) {
  const el = root.querySelector("#nf_tabbody");
  if (!el) return;
  el.innerHTML = '<span class="sm">loading...</span>';
  try {
    if (tab === "collections") await paintCollections(el);
    else await paintMine(el);
  } catch (e) { el.innerHTML = '<span class="sm">could not load: ' + esc(e.message) + "</span>"; }
}

async function paintCollections(el) {
  const cols = await nft.collections();
  if (!cols.length) { el.innerHTML = '<span class="sm">no collections yet. launch the first one.</span>'; return; }
  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">' + cols.map((c) => {
    const soldOut = c.minted >= c.maxSupply;
    const live = !soldOut && (!c.endAt || c.endAt * 1000 > Date.now()) && (!c.startAt || c.startAt * 1000 <= Date.now());
    const pct = c.maxSupply ? Math.floor((c.minted / c.maxSupply) * 100) : 0;
    const bars = Math.round(pct / 10);
    return `<a href="?view=nft&c=${esc(c.slug)}" style="text-decoration:none;border:1px solid var(--line);display:block">
      <div style="aspect-ratio:3/1;overflow:hidden;background:var(--panel)">${c.banner || c.logo ? `<img src="${esc(c.banner || c.logo)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : ""}</div>
      <div style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <span class="big" style="font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</span>
          <span class="chip ${soldOut ? "out" : live ? "live" : "soon"}" style="font-size:10px">${soldOut ? "SOLD OUT" : live ? "LIVE" : "NOT OPEN"}</span>
        </div>
        <div class="sm" style="margin-top:6px">[${"█".repeat(bars)}${"░".repeat(10 - bars)}] ${c.minted.toLocaleString()} / ${c.maxSupply.toLocaleString()}</div>
        <div class="kv sm" style="margin-top:6px"><span>price</span><span style="color:var(--acc)">${c.priceLamports ? fmtSol(c.priceLamports) : "FREE"}</span></div>
        <div class="kv sm" style="border-bottom:none"><span>owners</span><span>${c.owners ?? "-"}</span></div>
      </div>
    </a>`;
  }).join("") + "</div>";
}

async function paintMine(el) {
  if (!addr()) { el.innerHTML = '<div class="sm" style="border:1px dashed var(--acc);padding:22px;text-align:center">Connect your wallet (top right) to see the inscription NFTs it holds.</div>'; return; }
  const items = await nft.held(addr());
  if (!items.length) { el.innerHTML = '<span class="sm">this wallet holds no inscription NFTs yet.</span>'; return; }
  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">' + items.map((it) => `
    <a href="?view=nft&asset=${esc(it.asset)}" style="text-decoration:none;border:1px solid var(--line);display:block">
      <div style="aspect-ratio:1;overflow:hidden;background:var(--panel)">${it.inscriptionSig ? `<img src="${esc(imgUrl(it.inscriptionSig))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;image-rendering:pixelated">` : ""}</div>
      <div style="padding:8px 10px"><div class="big" style="font-size:16px">${esc(it.name || "#" + it.index)}</div><div class="sm">${esc(it.slug || "")}</div></div>
    </a>`).join("") + "</div>";
}

async function loadActivity(root) {
  const el = root.querySelector("#nf_activity");
  const cols = await nft.collections();
  const recents = (await Promise.all(cols.slice(0, 5).map(async (c) => {
    try { return (await nft.recent(c.slug, 5)).map((r) => ({ ...r, slug: c.slug, colName: c.name })); } catch (e) { return []; }
  }))).flat().sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0)).slice(0, 10);
  if (!el || !root.isConnected) return;
  if (!recents.length) { el.textContent = "no mints yet"; return; }
  el.innerHTML = recents.map((r) => `
    <a href="?view=nft&asset=${esc(r.asset)}" class="kv" style="text-decoration:none">
      <span><img src="${esc(imgUrl(r.inscriptionSig))}" alt="" loading="lazy" style="width:24px;height:24px;object-fit:cover;display:inline-block;vertical-align:middle;border:1px solid var(--line);margin-right:8px">${esc(r.colName)} #${r.index}</span>
      <span>minted by ${esc(shortAddr(r.owner))} · ${fmtWhen(r.registeredAt)}</span>
    </a>`).join("");
}
