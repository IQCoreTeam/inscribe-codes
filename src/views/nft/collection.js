// Collection page (design/NFT Launchpad Flow v5): header + item grid on the
// left, the mint panel on the right. Unminted items are SEALED (no art before
// mint; a sealed cell's rarity would leak the next sequential item). The mint
// panel is its own module (mintpanel.js), shared with the market.
import { esc, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { imgUrl } from "../../services/gateway.js";
import { tensorCollection } from "../../services/markets.js";
import { skeleton } from "../../ui/skeleton.js";
import { frame, statusOf, coverOf, unitChip } from "./launchpad.js";
import { mountMintPanel } from "./mintpanel.js";
import { paintWalletPill } from "./session.js";

const PAGE = 500;
const TIER_LABEL = { legendary: "Legendary", epic: "EPIC", rare: "RARE" };
const st = { col: null, items: [], total: 0, hasRarity: false, filter: "all" };

export async function render(root, slug) {
  const body = frame(root, `<div class="win nf-win nf-colwin"><div class="wh"><span>Collection · ${esc(slug)}</span><a class="wh-right wh-x" href="?view=nft" data-back>← back</a></div><div class="nf-note">loading...</div></div>`, { label: "Back", href: "?view=nft" });
  paintWalletPill(root.querySelector("#nav_wallet"));
  let col;
  try { col = await nft.collection(slug); }
  catch (e) { body.querySelector(".nf-note").textContent = 'could not load "' + slug + '": ' + e.message; return; }
  Object.assign(st, { col, items: [], total: 0, hasRarity: false, filter: "all" });

  const status = statusOf(col);
  const logo = col.logo || (col.coverSig ? imgUrl(col.coverSig) : "");
  body.innerHTML = `
<div class="win nf-win nf-colwin">
  <div class="wh"><span>Collection · ${esc(col.slug)}</span><a class="wh-right wh-x" href="?view=nft" data-back>← back</a></div>
  ${col.banner ? `<img class="nf-colbanner" src="${esc(col.banner)}" alt="">` : ""}
  <div class="nf-colpage">
    <div class="nf-colleft">
      <div class="nf-colhead">
        ${logo ? `<div class="nf-collogo"><img src="${esc(logo)}" alt=""></div>` : ""}
        <div class="nf-colinfo">
          <div class="nf-coltitle"><div class="nf-colname">${esc(col.name)}</div><span class="chip ${status === "LIVE" ? "live" : status === "Upcoming" ? "soon" : "out"}">${status}</span>${unitChip(col)}</div>
          <div class="cm" style="margin-top:6px">by ${esc(shortAddr(col.creator))} · ${col.maxSupply.toLocaleString("en-US")} items${col.symbol ? " · $" + esc(col.symbol) : ""}</div>
          <p class="nf-coldesc clamp" id="nc_desc">${esc(col.description || "")}</p>
          <button type="button" class="nf-descmore" id="nc_descmore" hidden>see more</button>
          <div class="nf-collinks lab">
            <a class="btn2" href="https://solscan.io/account/${esc(col.collection)}" target="_blank" rel="noopener">Collection on chain</a>
            <a class="btn2" href="?view=nft&market=${esc(col.slug)}">Market</a>
            ${(col.chain || "solana") === "solana" ? `<a class="btn2" href="${esc(tensorCollection(col.collection))}" target="_blank" rel="noopener">Tensor</a>` : ""}
          </div>
        </div>
      </div>
      <div class="nf-itemsbar">
        <div class="lab" style="opacity:.7">// ITEMS · ${col.sequential ? "sequential" : "random, committed shuffle"}</div>
        <div class="nf-tabs lab"><div class="tab on" data-f="all">All</div><div class="tab" data-f="avail">Available</div><div class="tab" data-f="minted">Minted</div></div>
      </div>
      <div class="nf-legend" id="nc_legend"><span style="opacity:.4;margin-left:auto">? = not minted yet</span></div>
      <div class="nf-itemscroll"><div class="nf-itemgrid" id="nc_grid">${skeleton(18, "cell")}</div><div class="nf-note" id="nc_gridnote"></div></div>
      <p class="cm" style="margin:14px 0 0">Bright = minted, with its owner. ? = still available.</p>
    </div>
    <div class="nf-colright" id="nc_panel"></div>
  </div>
</div>`;


  const desc = body.querySelector("#nc_desc"), dmore = body.querySelector("#nc_descmore");
  if (desc.scrollHeight > desc.clientHeight + 2) {
    dmore.hidden = false;
    dmore.onclick = () => { dmore.textContent = desc.classList.toggle("clamp") ? "see more" : "see less"; };
  }

  for (const t of body.querySelectorAll(".nf-tabs .tab")) t.onclick = () => {
    st.filter = t.dataset.f;
    for (const x of body.querySelectorAll(".nf-tabs .tab")) x.classList.toggle("on", x === t);
    paintGrid(root);
  };
  // The grid cell lights up and the counts move once a mint lands.
  const panel = mountMintPanel(body.querySelector("#nc_panel"), col, { onMinted: (c) => { st.col = c; st.items = []; loadItems(root); } });
  paintWalletPill(root.querySelector("#nav_wallet"), panel.repaint);
  loadItems(root);
}

// Items arrive 500 at a time and are drawn as they land; minted indexes are
// scattered (random assignment), so the Minted filter needs the whole set.
async function loadItems(root) {
  const note = root.querySelector("#nc_gridnote");
  let offset = 0;
  do {
    let res;
    try { res = await nft.items(st.col.slug, offset, PAGE); }
    catch (e) { if (note) note.textContent = e.message; return; }
    if (!root.isConnected) return;
    st.hasRarity = !!res.hasRarity;
    st.total = res.total || st.col.maxSupply;
    st.items.push(...res.items);
    offset += res.items.length;
    paintGrid(root);
    if (note) note.textContent = offset < st.total ? "loading " + offset + " / " + st.total + "..." : "";
    if (!res.items.length) break;
  } while (offset < st.total);
  if (st.hasRarity) {
    const l = root.querySelector("#nc_legend");
    if (l) l.innerHTML = '<span style="color:#b07a1a">■ Legendary 2%</span><span style="color:#6a3fb5">■ EPIC 8%</span><span style="color:#1f5fbf">■ RARE 20%</span><span>■ Common</span><span style="opacity:.4;margin-left:auto">? = not minted yet</span>';
  }
}

function paintGrid(root) {
  const grid = root.querySelector("#nc_grid");
  if (!grid) return;
  const items = st.items.filter((it) => st.filter === "all" || (st.filter === "avail" ? !it.minted : it.minted));
  grid.innerHTML = items.map(cellHtml).join("");
}

function cellHtml(it) {
  if (!it.minted) {
    const cover = coverOf(st.col);
    return `<div class="icell locked"><div class="icell-img">${cover ? `<img class="icell-lock" src="${esc(cover)}" alt="" loading="lazy">` : ""}<span class="icell-q">?</span><span class="icell-th">#${it.index}</span></div>
      <div class="icell-foot"><span>#${it.index}</span><span class="icell-st">available</span></div></div>`;
  }
  const tier = (it.rarity && it.rarity.tier) || "";
  return `<a class="icell minted ${tier}" href="?view=nft&asset=${esc(it.asset)}">
    <div class="icell-img"><img src="${esc(imgUrl(it.inscriptionSig))}" alt="" loading="lazy">${tier ? `<span class="icell-tag">${TIER_LABEL[tier] || tier}</span>` : ""}<span class="icell-th">#${it.index}</span></div>
    <div class="icell-foot"><span>${esc(shortAddr(it.owner))}</span><span class="icell-st">${tier ? TIER_LABEL[tier] : "minted"}</span></div></a>`;
}
