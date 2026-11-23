// NFT side (design/NFT Launchpad Flow v6). This module is the sub-router and
// the desk (LAUNCHPAD / MARKET / MY NFTS + the side window); the market, the
// collection page, the asset viewer, the single mint and the launch wizard are
// their own modules, dispatched on the query params:
//   ?view=nft                 -> this desk
//   ?view=nft&market=<slug>   -> this desk, on that collection's market
//   ?view=nft&c=<slug>        -> collection page
//   ?view=nft&asset=<a>  -> asset viewer
//   ?view=nft&single=<C> -> single 1/1 mint
import { nav } from "../../ui/nav.js";
import { skeleton } from "../../ui/skeleton.js";
import { typeLabels } from "../../ui/tty.js";
import { esc, fmtSol, fmtUsd, fmtWhen, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { imgUrl } from "../../services/gateway.js";
import { usdPrice } from "../../services/markets.js";
import { addr, paintWalletPill } from "./session.js";

export async function mount(root) {
  const q = new URLSearchParams(location.search);
  if (q.get("c")) return (await import("./collection.js")).render(root, q.get("c"));
  if (q.get("asset")) return (await import("./viewer.js")).render(root, q.get("asset"));
  if (q.get("single")) return (await import("./single.js")).render(root, q.get("single"));
  // The desk's tab and the open market collection live in the URL, so Back
  // and a shared link land on the same screen.
  st.tab = q.get("market") ? "market" : ["market", "mine"].includes(q.get("tab")) ? q.get("tab") : "cols";
  return desk(root);
}

// Shared page frame: nav + the viewport-high page column every NFT screen
// sits in. Returns the body element.
// `back` (see nav) is set by every screen below the desk.
export function frame(root, bodyHtml, back) {
  root.innerHTML = `<div class="nf-page">${nav("nft", back)}<div id="nf_body" class="nf-desk">${bodyHtml}</div></div><div id="nf_modal"></div>`;
  // Item links open the asset in a popup over the current screen instead of
  // routing away. Stop here (below document) so the global ?view= router does
  // not navigate; a direct ?asset= URL still renders the full page.
  root.querySelector(".nf-page").addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="?view=nft&asset="]');
    if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const asset = new URLSearchParams(a.getAttribute("href").slice(1)).get("asset");
    if (asset) import("./viewer.js").then((m) => m.openModal(asset));
  });
  typeLabels(root);
  return root.querySelector("#nf_body");
}

// ── collection facts shared by the desk cards and the collection page ──────
const SEGS = 40;
export const COLLECTION_CHAIN = { solana: { icon: "◎", name: "SOLANA", std: "MPL CORE", unit: "SOL" }, robinhood: { icon: "▲", name: "ROBINHOOD", std: "ERC721", unit: "ETH" } };
export const chainOf = (c) => COLLECTION_CHAIN[c.chain] || COLLECTION_CHAIN.solana;

export function statusOf(c) {
  const now = Date.now() / 1000;
  if (c.maxSupply && c.minted >= c.maxSupply) return "Sold out";
  if (c.endAt && c.endAt < now) return "Ended";
  if (c.startAt && c.startAt > now) return "Upcoming";
  return "LIVE";
}
// Ticker-colour class so the price, chip and activity amount pick up --tc from
// base.css (".t-NVDAx" etc). Empty for SOL.
export const tcls = (c) => { const u = nft.curOf(c); return u ? "t-" + u.symbol : ""; };
// A raw amount in a token's base unit, formatted like fmtSol but for N decimals,
// trailing zeros trimmed ("0.0120" -> "0.012").
const fmtAmount = (raw, decimals) => {
  const n = raw / 10 ** decimals;
  return (n >= 1 ? n.toFixed(2) : n.toFixed(n >= 0.01 ? 3 : 4)).replace(/\.?0+$/, "");
};
// A raw amount in the collection's own currency: "0.2 NVDAx", "0.40 SOL".
export const amountOf = (raw, c) => {
  const u = nft.curOf(c);
  return u ? fmtAmount(raw, u.decimals) + " " + u.symbol : fmtSol(raw);
};
export const priceOf = (c) => (c.priceLamports ? amountOf(c.priceLamports, c) : "FREE");
// "≈ $32.26" beside an amount. The slot is drawn empty and fillUsd writes the
// figure once the price arrives; it stays empty when there is none (and for
// Robinhood collections, whose currency this price source does not carry).
export const usdSlot = (raw, c) => {
  if ((c.chain || "solana") !== "solana" || !raw) return "";
  const u = nft.curOf(c);
  return `<span class="approx" data-usd="${raw / 10 ** (u ? u.decimals : 9)}" data-mint="${u ? esc(u.mint) : ""}"></span>`;
};
export function fillUsd(el) {
  for (const n of el.querySelectorAll("[data-usd]")) usdPrice(n.dataset.mint || undefined).then((p) => { if (p) n.textContent = "≈ " + fmtUsd(Number(n.dataset.usd) * p); });
}
// The ticker chip of a stock-priced collection (dot + ticker in the ticker
// colour, issuer on hover); nothing for SOL. `side` flips the hover label.
export const curChip = (c, side = "dn") => {
  const u = nft.curOf(c);
  return u ? `<span class="cur ${side} t-${esc(u.symbol)}">${esc(u.symbol)}${u.issuer ? `<i>${esc(u.issuer)}</i>` : ""}</span>` : "";
};
// The small tag on an item or collection: its token when it is priced in one
// (in the ticker colour), otherwise its chain.
export const unitChip = (c, cls = "") => {
  const u = nft.curOf(c);
  return `<span class="chip ${cls} ${u ? "tk t-" + esc(u.symbol) : ""}">${u ? esc(u.symbol) : chainOf(c).icon + " " + chainOf(c).name}</span>`;
};
export const coverOf = (c) => c.banner || c.logo || (c.coverSig ? imgUrl(c.coverSig) : "");
export const segsHtml = (minted, supply) => {
  const on = supply ? Math.round((SEGS * minted) / supply) : 0;
  let s = "";
  for (let k = 0; k < SEGS; k++) s += k < on ? '<i class="on"></i>' : "<i></i>";
  return s;
};

// ── desk ───────────────────────────────────────────────────────────────────
const PER = 6;
const st = { tab: "cols", chain: "all", cur: "any", page: 1, cols: null };

// The currency filter: "any" shows every collection, "stocks" the stock-priced
// ones, "SOL" the SOL-priced ones, a ticker only that currency.
export const curMatch = (c) => {
  const u = nft.curOf(c);
  return st.cur === "any" || (st.cur === "stocks" ? !!u : st.cur === "SOL" ? !u : !!u && u.symbol === st.cur);
};
export const chainMatch = (c) => st.chain === "all" || (c.chain || "solana") === st.chain;

async function desk(root) {
  frame(root, `
<div class="win nf-win nf-lp">
  <div class="wh">
    <span class="wtab" data-tab="cols">Launchpad</span><span class="wtab" data-tab="market">Market</span><span class="wtab" data-tab="mine">My nfts</span>
  </div>
  <div class="nf-lpbody">
    <div class="nf-tabrow">
      <div class="nf-filters">
        <div id="nf_filters" class="nf-filters">
          <select id="nf_cur" class="csel" hidden><option value="any">Any currency</option><option value="stocks">Priced in stocks</option><option value="SOL">SOL</option></select>
          <select id="nf_chain" class="csel"><option value="all">All chains</option><option value="solana">◎ Solana</option><option value="robinhood">▲ Robinhood</option></select>
        </div>
        <div id="nf_sortrow" class="nf-filters" hidden><span class="lab" style="letter-spacing:.1em">Sort</span><select id="nf_sort" class="csel">
          <option value="price">price (low to high)</option><option value="pricehi">price (high to low)</option>
          <option value="rare">rarity (rare to common)</option><option value="common">rarity (common to rare)</option>
          <option value="last">last sale (low to high)</option><option value="lasthi">last sale (high to low)</option>
          <option value="recent">recently listed</option>
        </select></div>
      </div>
      <button class="btn" id="nf_action"></button>
    </div>
    <div id="nf_tabbody" class="nf-tabbody"></div>
  </div>
</div>
<div class="win nf-win nf-act" id="nf_side"></div>`);

  paintWalletPill(root.querySelector("#nav_wallet"), () => { if (st.tab !== "cols") paintTab(root); });
  const again = () => { st.page = 1; paintTab(root); };
  const chain = root.querySelector("#nf_chain"), cur = root.querySelector("#nf_cur");
  chain.value = st.chain;
  chain.onchange = () => { st.chain = chain.value; again(); };
  cur.onchange = () => { st.cur = cur.value; again(); };
  for (const t of root.querySelectorAll(".wtab")) t.onclick = () => {
    st.tab = t.dataset.tab;
    history.replaceState(history.state, "", st.tab === "cols" ? "?view=nft" : "?view=nft&tab=" + st.tab);
    again();
  };
  // The currency filter exists only where stock currencies are offered to this
  // visitor; elsewhere the list is empty and every collection is in SOL.
  st.cur = "any";
  // Its tickers are the ones collections here are actually priced in, not the
  // whole offered list.
  Promise.all([nft.currencies(), st.cols || nft.collections()]).then(([list, cols]) => {
    st.cols = cols;
    if (!list.length || !cur.isConnected) return;
    for (const u of new Map(cols.map(nft.curOf).filter(Boolean).map((u) => [u.symbol, u])).values()) cur.add(new Option(u.symbol + " · " + u.issuer, u.symbol));
    cur.hidden = false;
  });
  root.querySelector("#nf_action").onclick = async () =>
    st.tab === "cols" ? (await import("./studio.js")).open(root) : (await import("./market.js")).openPicker(root);

  paintActivity(root);
  paintTab(root);
}

export async function paintTab(root) {
  for (const t of root.querySelectorAll(".wtab")) t.classList.toggle("on", t.dataset.tab === st.tab);
  const el = root.querySelector("#nf_tabbody");
  if (!el) return;
  root.querySelector("#nf_action").textContent = st.tab === "cols" ? "+ Launch a collection" : "+ List yours";
  root.querySelector("#nf_filters").hidden = st.tab === "mine";
  root.querySelector("#nf_sortrow").hidden = true;
  try {
    if (st.tab === "cols") await paintCollections(el);
    else if (st.tab === "market") await (await import("./market.js")).paintMarket(root, el);
    else await paintMine(root, el);
  } catch (e) { el.innerHTML = '<div class="nf-note">could not load: ' + esc(e.message) + "</div>"; }
}

async function paintCollections(el) {
  if (!st.cols) {
    el.innerHTML = `<div class="nf-scroll"><div class="nf-colgrid">${skeleton(6, "col")}</div></div>`;
    st.cols = await nft.collections();
    if (!el.isConnected || st.tab !== "cols") return;
  }
  const all = st.cols.filter((c) => chainMatch(c) && curMatch(c));
  const shown = Math.min(st.page * PER, all.length);
  const pages = Math.max(1, Math.ceil(all.length / PER));
  const where = st.chain === "all" ? "all chains" : st.chain === "solana" ? "on solana" : "on robinhood chain";
  el.innerHTML = `<div class="nf-scroll" id="nf_colscroll">
    <div class="nf-colgrid ttyrows">${all.length ? all.slice(0, shown).map(cardHtml).join("") : ""}</div>
    ${all.length ? "" : `<div class="nf-empty"><div class="t">Nothing ${esc(where)} yet.</div><div class="cm">The first collection here will be the first fully onchain one on this chain.</div></div>`}
    <div class="nf-pager">
      <span>// page ${st.page} / ${pages} · showing ${shown} of ${all.length}</span>
      ${shown < all.length ? `<span class="nf-more" id="nf_more">Load more ↓</span>` : `<span class="nf-eof">EOF · ${all.length} collection${all.length === 1 ? "" : "s"}, ${esc(where)}</span>`}
    </div>
  </div>`;
  const more = el.querySelector("#nf_more");
  if (more) more.onclick = () => { st.page++; paintCollections(el); };
}

function cardHtml(c) {
  const status = statusOf(c);
  const live = status === "LIVE";
  const ch = chainOf(c);
  const hot = live && c.lastMintAt && Date.now() / 1000 - c.lastMintAt < 86400;
  const cu = nft.curOf(c);
  const vol = !(c.minted && c.priceLamports) ? "-" : cu ? fmtAmount(c.minted * c.priceLamports, cu.decimals) + " " + cu.symbol : ((c.minted * c.priceLamports) / 1e9).toFixed(2) + " " + ch.unit;
  const cls = status === "Sold out" || status === "Ended" ? "colcard soldout dim" : live ? "colcard flick" : "colcard dim";
  const cover = coverOf(c);
  return `<a class="${cls}" href="?view=nft&c=${esc(c.slug)}">
  <div class="cc-cover">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : ""}</div>
  <div class="cc-name">${esc(c.name)}</div>
  <div class="cc-segs">${segsHtml(c.minted, c.maxSupply)}</div>
  <div class="cc-mintrow"><span class="${live ? "amber" : ""}">${c.minted.toLocaleString("en-US")} / ${c.maxSupply.toLocaleString("en-US")}</span></div>
  <p class="cc-desc">${esc(c.description || "")}</p>
  <div class="cc-stats">
    <div class="cc-stat"><div class="cc-k">OWNERS</div><div class="cc-v"><span>${c.owners ?? "-"}</span></div></div>
    <div class="cc-stat"><div class="cc-k">VOLUME</div><div class="cc-v"><span>${vol}</span></div></div>
  </div>
  <div class="cc-meta"><span>${ch.icon} ${ch.name} · ${ch.std} · ${esc(shortAddr(c.collection))}</span><span class="cc-tags">${curChip(c, "tr")}${hot ? '<span class="cc-hot">▲ HOT</span>' : ""}</span></div>
  <div class="band">
    <div class="bandfill ${live ? "live" : ""}" ${status === "Sold out" ? "hidden" : ""}></div>
    <div class="bandtext">
      <span class="band-price ${status === "Sold out" || status === "Ended" ? "" : tcls(c)}">${status === "Sold out" ? "minted out" : status === "Ended" ? "ended" : priceOf(c)}</span>
      <span class="band-cta">${live ? "Mint" : "View"} <span class="bandarrow">→</span></span>
    </div>
  </div>
</a>`;
}

const TIER = { legendary: "Legendary", epic: "EPIC", rare: "RARE" };

// What the wallet holds, plus what it has listed (a listed item may sit in the
// marketplace's escrow, so it is merged in by asset). A card opens the item's
// market popup: the list form, or the listing if it is already for sale.
async function paintMine(root, el) {
  if (!addr()) {
    el.innerHTML = `<div class="nf-empty">
      <div class="t">Connect to see yours.</div>
      <div class="cm">Your NFTs appear here once your wallet is connected. Minted or bought here, they all show up.</div>
      <button class="btn" id="nf_mineconn">Connect wallet</button>
    </div>`;
    el.querySelector("#nf_mineconn").onclick = () => document.querySelector("#nav_wallet .navconnect")?.click();
    return;
  }
  el.innerHTML = `<div class="nf-scroll"><div class="nf-minegrid">${skeleton(6, "nftitem")}</div></div>`;
  const market = await import("./market.js");
  const items = await market.owned(addr());
  if (!el.isConnected || st.tab !== "mine") return;
  const count = (tier) => items.filter((it) => ((it.rarity && it.rarity.tier) || "common") === tier).length;
  const tiers = ["legendary", "epic", "rare", "common"].filter(count).map((t) => count(t) + " " + (TIER[t] || "Common")).join(" · ");
  el.innerHTML = `
  <div class="nf-minehead"><span><b>${items.length} NFTS</b>held by ${esc(shortAddr(addr()))}</span><span>${tiers}</span></div>
  <div class="nf-scroll"><div class="nf-minegrid ttyrows">${items.map(mineCardHtml).join("")}</div>
  ${items.length ? "" : '<div class="nf-empty"><div class="t">Nothing here yet.</div><div class="cm">Mint from a collection and it lands here.</div></div>'}</div>`;
  el.querySelectorAll(".rc").forEach((card, i) => { card.onclick = (e) => { if (!e.target.closest("a")) market.openItem(root, items[i]); }; });
}

function mineCardHtml(it) {
  const tier = it.rarity && it.rarity.tier;
  return `<div class="rc ${tier || "common"} ${tier && tier !== "common" ? "strong" : ""}">
    <div class="rc-img">${it.inscriptionSig ? `<img src="${esc(imgUrl(it.inscriptionSig))}" alt="" loading="lazy">` : ""}<span class="rc-tag">${TIER[tier] || "Common"}</span></div>
    <div class="rc-name">${esc(it.name || it.collectionName + " #" + it.index)}</div>
    <div class="rc-sub">${esc(it.collectionName || it.slug || "")} · ${fmtWhen(it.registeredAt) || "#" + it.index}</div>
    <div class="rc-foot"><a href="?view=nft&asset=${esc(it.asset)}">View</a><span style="margin-left:auto">${it.listing ? "Manage" : "List"} →</span></div>
  </div>`;
}

// The side window's default content: the latest mints, sales and listings
// across the newest collections. The market swaps a mint panel in here while a
// collection is open and calls this to put the activity back.
export async function paintActivity(root) {
  const side = root.querySelector("#nf_side");
  side.innerHTML = '<div class="wh"><span data-tty>Activity</span></div><div class="nf-actbody ttyrows" id="nf_activity"><div class="nf-acthead"><span>Recent activity</span></div></div>';
  typeLabels(side);
  const el = side.querySelector("#nf_activity");
  const note = (t) => el.isConnected && el.insertAdjacentHTML("beforeend", '<div class="nf-note">' + t + "</div>");
  let recents;
  try {
    const cols = st.cols || (st.cols = await nft.collections());
    recents = (await Promise.all(cols.slice(0, 6).map(async (c) => {
      try { return (await nft.recent(c.slug, 6)).map((r) => ({ ...r, col: c })); } catch (e) { return []; }
    }))).flat().sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0)).slice(0, 12);
  } catch (e) { return note("activity unavailable right now"); }
  if (!el.isConnected) return;
  if (!recents.length) return note("no mints yet");
  const evOf = (k) => (k === "sale" ? "SOLD" : k === "list" ? "LISTED" : "MINT");
  // Every amount is in its collection's currency: a mint at the mint price, a
  // sale or listing at its own.
  el.insertAdjacentHTML("beforeend", recents.map((r) => `
    <a class="actrow flickrow" href="?view=nft&asset=${esc(r.asset)}">
      <div class="act-l"><img src="${esc(imgUrl(r.inscriptionSig))}" alt="" loading="lazy">
        <div style="min-width:0"><div class="act-name">${esc(r.col.name)} #${r.index}</div>
        <div class="act-sub"><span class="act-ev ${r.kind}">${evOf(r.kind)}</span><span class="act-amt ${tcls(r.col)}">${esc(r.kind !== "mint" && r.price ? amountOf(r.price, r.col) : priceOf(r.col))}</span></div></div></div>
      <span class="act-time">${fmtWhen(r.registeredAt)}</span>
    </a>`).join(""));
}
