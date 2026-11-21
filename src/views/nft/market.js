// The market (design/NFT Launchpad Flow v6). The tab is a list of collections,
// the most recently sold first; opening one shows its listings and puts its
// mint panel in the side window. An item popup buys, lists or cancels inside
// the site, and "+ List yours" picks one of the wallet's items to list.
//
// An item trades in its collection's currency and no other, so no menu here
// offers a currency: the price label, the amounts and the colours follow the
// collection. Stock-priced collections a visitor's region is not offered never
// reach this module (the backend leaves them out).
import { esc, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { imgUrl } from "../../services/gateway.js";
import { skeleton } from "../../ui/skeleton.js";
import { typeLabels } from "../../ui/tty.js";
import { connect as rpcConnect } from "../../chain/rpc.js";
import { paintTab, paintActivity, curMatch, chainMatch, chainOf, statusOf, coverOf, amountOf, tcls, curChip, usdSlot, fillUsd } from "./launchpad.js";
import { mountMintPanel } from "./mintpanel.js";
import { session, addr, connectWallet, paintWalletPill } from "./session.js";

// rows: the collection list. sel: the open collection's slug. listings: active
// listings per slug, kept for the page so a popup's result can be patched in
// before the backend's next marketplace poll sees it.
const mk = { rows: null, sel: null, listings: new Map(), seen: new Map() };

export const select = (slug) => { mk.sel = slug; };

async function listingsOf(slug) {
  if (!mk.listings.has(slug)) mk.listings.set(slug, (await nft.listings(slug)).listings || []);
  return mk.listings.get(slug);
}

const TIER_RANK = { legendary: 0, epic: 1, rare: 2 };
const rank = (l) => TIER_RANK[l.rarity] ?? 3;
const SORTS = {
  price: (a, b) => a.price - b.price,
  pricehi: (a, b) => b.price - a.price,
  rare: (a, b) => rank(a) - rank(b) || a.price - b.price,
  common: (a, b) => rank(b) - rank(a) || a.price - b.price,
  last: (a, b) => a.lastSale - b.lastSale,
  lasthi: (a, b) => b.lastSale - a.lastSale,
  recent: (a, b) => b.listedAt - a.listedAt,
};
const change = (v) => {
  const n = Math.round(v * 100) / 100;
  return `<span class="mk-chg ${n > 0 ? "up" : n < 0 ? "down" : ""}">${n > 0 ? "+" : ""}${n.toFixed(2)}%</span>`;
};
const items = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n)) + " items";
// "0.2 NVDAx" as a number and a small unit, the unit in the ticker colour.
const split = (raw, c) => { const [n, u] = amountOf(raw, c).split(" "); return `<span class="mk-n">${esc(n)}</span> <span class="u ${tcls(c)}">${esc(u)}</span>`; };

export async function paintMarket(root, el) {
  if (!mk.rows) el.innerHTML = `<div class="nf-scroll">${skeleton(4)}</div>`;
  const fresh = await nft.market();
  if (!el.isConnected) return;
  // A collection whose latest sale moved since the last look is highlighted once.
  const bumped = new Set(fresh.filter((r) => mk.seen.has(r.slug) && r.lastSaleAt > mk.seen.get(r.slug)).map((r) => r.slug));
  for (const r of fresh) mk.seen.set(r.slug, r.lastSaleAt);
  mk.rows = fresh;
  const col = mk.sel && fresh.find((r) => r.slug === mk.sel);
  if (col) return paintCollection(root, el, col);
  mk.sel = null;
  paintActivityOnce(root);

  const rows = fresh.filter((r) => chainMatch(r) && curMatch(r));
  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  el.innerHTML = `
  <div class="nf-stats three">
    <div><div class="k">Listed</div><div class="v">${sum("listed") || "-"}</div></div>
    <div><div class="k">Collections</div><div class="v">${rows.length || "-"}</div></div>
    <div><div class="k">Owners</div><div class="v">${sum("owners") || "-"}</div></div>
  </div>
  <div class="mkhead"><span></span><span>Collection</span><span>Floor</span><span>Listed</span><span style="text-align:right">24h Δ</span><span></span></div>
  <div class="nf-scroll mk-scroll">
    ${rows.length ? "" : '<div class="nf-empty"><div class="t">No collections here yet.</div><div class="cm">Listings appear here in the currency of their collection.</div></div>'}
    ${rows.map((r) => {
      const ch = chainOf(r), cover = r.logo || coverOf(r);
      return `<div class="mkrow ${bumped.has(r.slug) ? "bump" : ""}" data-slug="${esc(r.slug)}">
        ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : "<span></span>"}
        <div class="mk-name"><div><span>${esc(r.name)}</span>${curChip(r)}</div><div class="mk-sub">${ch.icon} ${esc(ch.name.charAt(0) + ch.name.slice(1).toLowerCase())} · ${items(r.maxSupply)}</div></div>
        <div class="mk-floor">${r.floor ? split(r.floor, r) + `<div class="mk-sub">${usdSlot(r.floor, r)}</div>` : "-"}</div>
        <div>${r.listed}</div>
        <div style="text-align:right">${change(r.change24h)}</div>
        <span class="mk-arrow">→</span>
      </div>`;
    }).join("")}
  </div>
  <div class="nf-pager"><span>// ${rows.length} collection${rows.length === 1 ? "" : "s"} · latest sale first</span></div>`;
  fillUsd(el);
  for (const row of el.querySelectorAll(".mkrow")) row.onclick = () => { mk.sel = row.dataset.slug; paintTab(root); };
}

// The side window shows the activity feed unless a mint panel replaced it.
function paintActivityOnce(root) {
  if (!root.querySelector("#nf_activity")) paintActivity(root);
}

async function paintCollection(root, el, col) {
  root.querySelector("#nf_filters").hidden = true;
  root.querySelector("#nf_sortrow").hidden = false;
  const sort = root.querySelector("#nf_sort");
  sort.onchange = () => paintTab(root);
  const cur = nft.curOf(col), ch = chainOf(col), cover = col.logo || coverOf(col);
  const head = `
  <div class="mk-colhead">
    <div class="btn2 mk-back" id="mk_back">← All collections</div>
    ${cover ? `<img src="${esc(cover)}" alt="">` : ""}
    <div class="mk-coltitle"><div class="t">${esc(col.name)}</div><div class="mk-sub">${ch.icon} ${esc(ch.name.charAt(0) + ch.name.slice(1).toLowerCase())} · ${items(col.maxSupply)} · <span class="${tcls(col)} mk-trades">trades in ${esc(cur ? cur.symbol + (cur.issuer ? " (" + cur.issuer + ")" : "") : ch.unit)}</span></div></div>
    <div class="mk-colstats">
      <div><div class="lab">Floor</div><div>${col.floor ? split(col.floor, col) : "-"}</div></div>
      <div><div class="lab">Listed</div><div>${col.listed}</div></div>
      <div><div class="lab">24h Δ</div><div>${change(col.change24h)}</div></div>
    </div>
  </div>`;
  el.innerHTML = head + `<div class="nf-scroll mk-scroll2"><div class="mk-grid">${skeleton(6, "nftitem")}</div></div>`;
  el.querySelector("#mk_back").onclick = () => { mk.sel = null; paintTab(root); };

  // Its mint panel takes the side window while it can still be minted.
  const side = root.querySelector("#nf_side");
  if (statusOf(col) === "Sold out") paintActivityOnce(root);
  else if (side.dataset.mint !== col.slug) {
    side.innerHTML = `<div class="wh"><span data-tty>Mint</span><a class="wh-right" href="?view=nft&c=${esc(col.slug)}">All items →</a></div><div class="nf-colright" id="mk_mint"></div>`;
    typeLabels(side);
    mountMintPanel(side.querySelector("#mk_mint"), col);
  }
  side.dataset.mint = statusOf(col) === "Sold out" ? "" : col.slug;

  const list = (await listingsOf(col.slug)).slice().sort(SORTS[sort.value]);
  const grid = el.querySelector(".mk-grid");
  if (!grid || mk.sel !== col.slug) return;
  if (!list.length) {
    grid.outerHTML = `<div class="nf-empty"><div class="t">Nothing for sale in ${esc(col.name)} right now.</div><div class="cm">Own one? Use "+ List yours".</div></div>`;
    return;
  }
  grid.innerHTML = list.map((l) => {
    const mine = addr() && l.seller === addr();
    return `<div class="mkcard flick" data-asset="${esc(l.asset)}">
      <div class="mk-img">${l.inscriptionSig ? `<img src="${esc(imgUrl(l.inscriptionSig))}" alt="" loading="lazy">` : ""}<span class="chip">${ch.name}</span>${l.rarity ? `<span class="chip mk-tier ${l.rarity}">${l.rarity.toUpperCase()}</span>` : ""}</div>
      <div class="mk-body">
        <div class="mk-item">#${l.index ?? "?"}</div>
        <div class="mk-sub">${mine ? "your listing" : "seller " + esc(shortAddr(l.seller))}</div>
        <div class="mk-price"><span><span class="mk-big ${tcls(col)}">${esc(amountOf(l.price, col).split(" ")[0])}</span> <span class="lab ${tcls(col)}">${esc(amountOf(l.price, col).split(" ")[1])}</span></span><span class="lab">${usdSlot(l.price, col)}</span></div>
        <div class="mk-foot"><span class="lab mk-act ${mine ? "mine" : ""}">${mine ? "Manage" : "Buy"} →</span><span class="lab">${l.lastSale ? "last " + esc(amountOf(l.lastSale, col)) : ""}</span></div>
      </div>
    </div>`;
  }).join("");
  fillUsd(grid);
  el.insertAdjacentHTML("beforeend", `<div class="nf-pager"><span>// ${list.length} for sale · ${esc(sort.options[sort.selectedIndex].text)}</span></div>`);
  for (const card of grid.querySelectorAll(".mkcard")) card.onclick = () => openItem(root, { ...list.find((l) => l.asset === card.dataset.asset), slug: col.slug });
}

// ── what a wallet can list or manage ────────────────────────────────────────
// Held items plus the wallet's own listings (a listed item can sit in the
// marketplace's escrow and drop out of "held"), each marked with its listing.
export async function owned(wallet) {
  const [held, rows] = await Promise.all([nft.held(wallet), mk.rows || nft.market()]);
  mk.rows = rows;
  const listed = (await Promise.all(rows.filter((r) => r.listed).map(async (r) =>
    (await listingsOf(r.slug).catch(() => [])).filter((l) => l.seller === wallet).map((l) => ({ ...l, slug: r.slug, collectionName: r.name, listing: l }))))).flat();
  const byAsset = new Map(listed.map((l) => [l.asset, l]));
  return [...held.map((h) => (byAsset.has(h.asset) ? { ...h, listing: byAsset.get(h.asset).listing } : h)), ...listed.filter((l) => !held.some((h) => h.asset === l.asset))];
}

const overlay = (id, inner) => `<div class="nf-overlay" id="${id}">${inner}</div>`;
function openOverlay(html) {
  const modal = document.querySelector("#nf_modal");
  modal.innerHTML = html;
  const ov = modal.firstElementChild;
  typeLabels(ov);
  const close = () => { if (ov.isConnected) modal.innerHTML = ""; document.removeEventListener("keydown", onEsc); };
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onEsc);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest(".mk-x")) close(); };
  return ov;
}
// Connect from inside a popup, then reopen it for the connected wallet.
const connectThen = (root, reopen) => connectWallet().then(() => {
  paintWalletPill(root.querySelector("#nav_wallet"), () => paintTab(root));
  paintTab(root);
  reopen();
}).catch((e) => alert(e.message));

// "+ List yours": the wallet's items that are not for sale yet.
export async function openPicker(root) {
  const ov = openOverlay(overlay("mk_pick", `<div class="win mk-pop mk-pick"><div class="wh"><span data-tty>List</span><span class="mk-hl">pick one of yours</span><span class="wh-right wh-x mk-x">x</span></div><div class="mk-pickbody" id="mk_pickbody"></div></div>`));
  const body = ov.querySelector("#mk_pickbody");
  if (!addr()) {
    body.innerHTML = '<div class="nf-empty"><div class="t">Connect to see yours.</div><button class="btn" id="mk_pickconn">Connect wallet</button></div>';
    body.querySelector("#mk_pickconn").onclick = () => connectThen(root, () => openPicker(root));
    return;
  }
  body.innerHTML = `<div class="mk-grid">${skeleton(3, "nftitem")}</div>`;
  const mine = (await owned(addr())).filter((it) => !it.listing);
  if (!body.isConnected) return;
  if (!mine.length) { body.innerHTML = '<div class="nf-empty"><div class="t">Nothing left to list.</div><div class="cm">Everything you own is already for sale.</div></div>'; return; }
  body.innerHTML = `<div class="mk-grid">${mine.map((it, i) => `<div class="mkcard flick" data-i="${i}">
    <div class="mk-img">${it.inscriptionSig ? `<img src="${esc(imgUrl(it.inscriptionSig))}" alt="">` : ""}<span class="chip">SOLANA</span></div>
    <div class="mk-body"><div class="mk-item">${esc(it.name || it.collectionName + " #" + it.index)}</div><div class="mk-sub">${esc(it.collectionName || "")}</div></div></div>`).join("")}</div>`;
  for (const card of body.querySelectorAll(".mkcard")) card.onclick = () => openItem(root, mine[Number(card.dataset.i)]);
}

// ── item popup: buy, list, or my listing ────────────────────────────────────
// it: { asset, slug, index, inscriptionSig } plus a listing's { price, seller,
// lastSale } when it came from one. The popup decides its own state from the
// collection's listings and the connected wallet.
export async function openItem(root, it) {
  const ov = openOverlay(overlay("mk_item", '<div class="nf-note">loading…</div>'));
  const [rows, list] = await Promise.all([mk.rows || nft.market(), listingsOf(it.slug)]);
  if (!ov.isConnected) return;
  mk.rows = rows;
  const col = rows.find((r) => r.slug === it.slug);
  if (!col) { ov.innerHTML = '<div class="nf-note">this item is not on the market here</div>'; return; }
  const cur = nft.curOf(col), unit = cur ? cur.symbol : chainOf(col).unit, decimals = cur ? cur.decimals : 9;
  const name = `${col.name} #${it.index ?? "?"}`;
  const st = { listing: list.find((l) => l.asset === it.asset) || null, phase: "idle", quote: null, error: null, ask: "", done: null };
  const price = (raw) => `<span class="${tcls(col)}">${esc(amountOf(raw, col))}</span> ${usdSlot(raw, col)}`;
  const kv = (k, v, cls = "") => `<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;
  const disclose = cur ? '<div class="cm mk-fine">Not issued or custodied by inscribe.codes. Eligibility follows the issuer\'s terms.</div>' : "";
  const waiting = '<div class="ttyspin nf-approve">Approve in your wallet…</div>';
  const confirming = (t) => `<div class="ttyspin cm">Confirming on Solana…${t || ""}</div>`;
  const done = (t) => `<div class="mk-done">${t}</div>`;

  function paint() {
    const l = st.listing, me = addr(), mine = l ? l.seller === me : !!me && (it.owner ? it.owner === me : true);
    const owner = l ? l.seller : me;
    let block;
    if (st.done) block = done(st.done);
    else if (l && !mine) block = buyHtml(l);
    else if (l) block = `<div class="lab mk-you">Listed · ${price(l.price)}</div>${st.phase === "waiting" ? waiting : st.phase === "confirming" ? confirming() : '<div class="btn2 mk-wide" id="mk_cancel">Cancel listing</div>'}`;
    else if (mine) block = listHtml();
    else block = '<div class="cm">Not listed right now.</div>';
    ov.innerHTML = `<div class="win mk-pop">
      <div class="wh"><span data-tty>Item</span><span class="mk-hl">${esc(name)}</span>${curChip(col)}<span class="wh-right">${chainOf(col).name} · ${esc(shortAddr(it.asset))}</span><span class="wh-x mk-x">x</span></div>
      <div class="mk-popgrid">
        <div><div class="mk-popimg">${it.inscriptionSig ? `<img src="${esc(imgUrl(it.inscriptionSig))}" alt="">` : ""}</div><div class="cm" style="margin-top:8px">${esc(col.name)} · owner ${owner === me && me ? "you" : esc(shortAddr(owner || ""))}</div></div>
        <div class="mk-popright">
          <div class="lab" style="letter-spacing:.2em">Market</div>
          <div>${kv("seller", l ? (mine ? "you" : esc(shortAddr(l.seller))) : mine ? "you" : "-")}${kv("last sale", (l && l.lastSale) || it.lastSale ? esc(amountOf((l && l.lastSale) || it.lastSale, col)) : "-")}${l ? "" : kv("status", "not listed")}</div>
          ${block}
          ${st.error ? `<div class="cm" style="color:var(--bad)">${esc(st.error)}</div>` : ""}
          ${disclose}
          <div class="mk-links"><a class="btn2" href="https://solscan.io/token/${esc(it.asset)}" target="_blank" rel="noopener">Solscan</a><a class="btn2" href="?view=nft&asset=${esc(it.asset)}">View image on chain</a><span class="btn2" id="mk_share">Share</span></div>
        </div>
      </div></div>`;
    typeLabels(ov);
    fillUsd(ov);
    const on = (sel, fn) => { const n = ov.querySelector(sel); if (n) n.onclick = fn; };
    on("#mk_share", (e) => { navigator.clipboard?.writeText(location.origin + location.pathname + "?view=nft&asset=" + it.asset); e.target.textContent = "Link copied"; });
    on("#mk_conn", () => connectThen(root, () => openItem(root, it)));
    on("#mk_buy", buy);
    on("#mk_list", listIt);
    on("#mk_cancel", cancel);
    const ask = ov.querySelector("#mk_ask");
    if (ask) ask.oninput = () => { st.ask = ask.value; const b = ov.querySelector("#mk_list"); if (b) b.textContent = listCta(); const u = ov.querySelector("#mk_askusd"); if (u) { u.innerHTML = usdSlot(askRaw(), col); fillUsd(u); } };
  }

  // The cost box. Tensor's total (or, without one, a simulation) gives the real
  // amount once a wallet is connected; until then only the price is known.
  function buyHtml(l) {
    const q = st.quote, later = '<span class="approx">quoted at buy</span>';
    const short = q && q.have != null && q.have < (q.total ?? l.price);
    const cta = "Buy now · " + esc(amountOf(l.price, col));
    return `<div class="mk-cost">
        ${kv("price", price(l.price))}
        ${kv("creator royalty", q && q.royalty != null ? esc(amountOf(q.royalty, col)) : later)}
        ${kv("marketplace fee", q && q.fee != null ? esc(amountOf(q.fee, col)) : later)}
        ${kv("Total", q && q.total != null ? price(q.total) : later, "mk-total")}
      </div>
      <div class="cm mk-fine" style="margin-top:-6px">Final total is quoted by the marketplace when you buy.</div>
      ${!addr() ? '<div class="btn mk-wide" id="mk_conn">Connect wallet to buy</div>'
        : st.phase === "waiting" ? waiting
        : st.phase === "confirming" ? confirming(q && q.total != null ? " paying " + esc(amountOf(q.total, col)) : "")
        : short ? `<div class="btn2 mk-wide mk-off">${cta}</div><div class="cm" style="color:var(--cta)">Not enough ${esc(unit)} in your wallet.</div><div class="cm mk-fine">You need ${esc(amountOf(q.total ?? l.price, col))}. You have ${esc(amountOf(q.have, col))}.</div>`
        : !q ? '<div class="ttyspin cm">getting the marketplace quote…</div>'
        : `<div class="btn mk-wide mk-buy" id="mk_buy">${cta}</div>${cur ? `<div class="cm mk-fine">Paid in ${esc(unit)} from your wallet.</div>` : ""}`}`;
  }

  const askRaw = () => Math.round(parseFloat(st.ask || "0") * 10 ** decimals) || 0;
  const listCta = () => (askRaw() ? `List for ${amountOf(askRaw(), col)} · 1 signature` : "Enter a price");
  function listHtml() {
    return `<div class="lab mk-you">You own this. List it?</div>
      <div class="mk-askrow"><div><div class="lab" style="letter-spacing:.1em;margin-bottom:4px">Price (${esc(unit)})</div><input class="inp" id="mk_ask" inputmode="decimal" value="${esc(st.ask)}"></div><div class="cm"><span class="${tcls(col)}">${esc(unit)}</span> <span id="mk_askusd">${usdSlot(askRaw(), col)}</span></div></div>
      <div class="cm mk-fine">${esc(col.name)} trades in ${esc(unit)}${cur && cur.issuer ? " (" + esc(cur.issuer) + ")" : ""}. The currency was fixed when the collection launched.</div>
      ${!addr() ? '<div class="btn mk-wide" id="mk_conn">Connect wallet to list</div>'
        : st.phase === "waiting" ? waiting : st.phase === "confirming" ? confirming()
        : `<div class="btn mk-wide" id="mk_list">${esc(listCta())}</div><div class="cm mk-fine">${col.floor ? "floor " + esc(amountOf(col.floor, col)) : "no listings yet"}</div>`}`;
  }

  // One signed trade: approve -> confirming -> the done line, with the page's
  // listings patched so the grid matches before the backend's next poll.
  async function trade(path, body, after) {
    if (st.phase !== "idle") return;
    st.error = null; st.phase = "waiting"; paint();
    try {
      const { buildTrade, sendTrade } = await import("../../chain/trade.js");
      const built = await buildTrade(path, body);
      await sendTrade(rpcConnect(), session.wallet, built, () => { st.phase = "confirming"; paint(); });
      const kept = mk.listings.get(it.slug).filter((l) => l.asset !== it.asset);
      mk.listings.set(it.slug, after.listing ? [...kept, after.listing] : kept);
      st.listing = null; st.done = after.done;
    } catch (e) { st.error = String((e && e.message) || e); }
    st.phase = "idle";
    paint();
    if (st.done) paintTab(root);
  }
  const buy = () => trade("/market/buy", { mint: it.asset, buyer: addr(), owner: st.listing.seller, maxPrice: st.quote.cap },
    { done: `Bought ✓ ${st.quote && st.quote.total != null ? "paid " + esc(amountOf(st.quote.total, col)) + " · " : ""}now in My NFTs` });
  const listIt = () => askRaw() && trade("/market/list", { mint: it.asset, owner: addr(), price: askRaw() },
    { done: `Listed ✓ <span class="${tcls(col)}">${esc(amountOf(askRaw(), col))}</span>`, listing: { asset: it.asset, index: it.index, inscriptionSig: it.inscriptionSig, price: askRaw(), seller: addr(), source: "TCOMP", listedAt: Math.floor(Date.now() / 1000), lastSale: it.lastSale || 0, rarity: (it.rarity && it.rarity.tier) || it.rarity || null } });
  const cancel = () => trade("/market/delist", { mint: it.asset, owner: addr() }, { done: "Delisted ✓" });

  paint();
  // Quote a purchase for the connected wallet: the split of the total and
  // whether the wallet holds enough of the listing's currency.
  const l = st.listing;
  if (l && addr() && l.seller !== addr()) {
    try {
      const { buildTrade, buyerBalance, simulatedCost } = await import("../../chain/trade.js");
      const connection = rpcConnect(), buyer = session.wallet.publicKey;
      // maxPrice is the ceiling on everything the buyer pays, royalty and
      // marketplace fee included (a ceiling at the bare price is refused on
      // chain). The first build tells us the royalty; the ceiling then leaves
      // room for it and a 3% fee, and the chain charges only what is due.
      const body = { mint: it.asset, buyer: addr(), owner: l.seller, maxPrice: l.price };
      const { royaltyBps } = await buildTrade("/market/buy", body);
      const cap = Math.ceil(l.price * (1 + (royaltyBps || 0) / 10000 + 0.03));
      const built = await buildTrade("/market/buy", { ...body, maxPrice: cap });
      const total = built.totalCost ?? (cur ? null : await simulatedCost(connection, buyer, built));
      const royalty = royaltyBps == null ? null : Math.floor((l.price * royaltyBps) / 10000);
      const fee = total != null && royalty != null && total - l.price - royalty >= 0 ? total - l.price - royalty : null;
      st.quote = { cap, total, royalty, fee, have: await buyerBalance(connection, buyer, cur && cur.mint) };
    } catch (e) { st.error = String((e && e.message) || e); }
    if (ov.isConnected && st.phase === "idle" && !st.done) paint();
  }
}
