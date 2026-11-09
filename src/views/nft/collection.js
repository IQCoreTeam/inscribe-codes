// Collection page: header + mint panel + the item grid. Unminted items are
// SEALED (no art shown anywhere before mint; a sealed cell's rarity would leak
// the next sequential item). Minting runs the full engine with a staged
// progress modal and a resume banner for an interrupted mint.
import { esc, fmtSol, fmtWhen, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { imgUrl } from "../../services/gateway.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { frame } from "./launchpad.js";
import { session, addr, connectWallet, ensureBurner, paintWalletPill } from "./session.js";

const PAGE = 500;

export async function render(root, slug) {
  const body = frame(root, '<div class="sm">loading ' + esc(slug) + "...</div>");
  paintWalletPill(root.querySelector("#nf_wallet"), () => paintMintPanel(root));
  let col;
  try { col = await nft.collection(slug); }
  catch (e) { body.innerHTML = '<div class="sm">could not load "' + esc(slug) + '": ' + esc(e.message) + "</div>"; return; }
  st.col = col; st.items = []; st.offset = 0; st.hasRarity = false;

  const pct = col.maxSupply ? Math.floor((col.minted / col.maxSupply) * 100) : 0;
  body.innerHTML = `
  ${col.banner ? `<div style="aspect-ratio:4/1;overflow:hidden;background:var(--panel);border:1px solid var(--line)"><img src="${esc(col.banner)}" alt="" style="width:100%;height:100%;object-fit:cover"></div>` : ""}
  <div style="display:flex;gap:16px;align-items:flex-end;margin-top:${col.banner ? "-32px" : "0"};padding:0 16px">
    ${col.logo ? `<img src="${esc(col.logo)}" alt="" style="width:84px;height:84px;object-fit:cover;border:1px solid var(--acc);background:var(--bg)">` : ""}
    <div style="flex:1;min-width:0;padding-bottom:4px">
      <div class="hero" style="font-size:30px">${esc(col.name)} <span class="sm">$${esc(col.symbol || "")}</span></div>
      <div class="sm" style="margin-top:2px">${esc(col.description || "")} · by ${esc(shortAddr(col.creator))}</div>
    </div>
  </div>
  <div class="grid2" style="display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;margin-top:16px;align-items:start">
    <div class="win">
      <div class="wh"><span>items</span><span class="sm">[${"█".repeat(Math.round(pct / 10))}${"░".repeat(10 - Math.round(pct / 10))}] ${col.minted.toLocaleString()} / ${col.maxSupply.toLocaleString()} minted</span></div>
      <div id="nc_grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;padding:12px;max-height:70vh;overflow-y:auto"><span class="sm">loading items...</span></div>
      <div style="padding:0 12px 12px"><button class="chip" id="nc_more" style="display:none">LOAD MORE</button></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="win">
        <div class="wh"><span>mint</span></div>
        <div id="nc_mint" style="padding:14px"></div>
      </div>
      <div class="win">
        <div class="wh"><span>recent</span></div>
        <div id="nc_recent" style="padding:10px 14px" class="sm">loading...</div>
      </div>
    </div>
  </div>`;

  paintMintPanel(root);
  root.querySelector("#nc_more").onclick = () => loadItems(root);
  loadItems(root);
  nft.recent(slug, 8).then((rs) => {
    const el = root.querySelector("#nc_recent");
    if (!el) return;
    el.innerHTML = rs.length ? rs.map((r) => `<a href="?view=nft&asset=${esc(r.asset)}" class="kv" style="text-decoration:none"><span>#${r.index}</span><span>${esc(shortAddr(r.owner))} · ${fmtWhen(r.registeredAt)}</span></a>`).join("") : "no mints yet";
  }).catch(() => {});
}

const st = { col: null, items: [], offset: 0, minting: false };

async function loadItems(root) {
  const grid = root.querySelector("#nc_grid");
  const more = root.querySelector("#nc_more");
  if (!grid) return;
  const res = await nft.items(st.col.slug, st.offset, PAGE).catch((e) => ({ items: [], error: e.message }));
  if (res.error) { grid.innerHTML = '<span class="sm">' + esc(res.error) + "</span>"; return; }
  st.hasRarity = !!res.hasRarity;
  if (st.offset === 0) grid.innerHTML = "";
  st.offset += res.items.length;
  st.items.push(...res.items);
  grid.insertAdjacentHTML("beforeend", res.items.map(cellHtml).join(""));
  more.style.display = st.offset < st.col.maxSupply && res.items.length === PAGE ? "" : "none";
}

const RARITY_COLOR = { legendary: "var(--cta)", epic: "#c580ff", rare: "var(--acc)" };

function cellHtml(it) {
  if (!it.minted) {
    // sealed: never show the art before mint
    return `<div style="border:1px solid var(--line);aspect-ratio:1;display:grid;place-items:center;background:var(--panel);opacity:.6">
      <span class="hero" style="font-size:26px;color:var(--ink2);text-shadow:1px 0 rgba(63,210,79,.5),-1px 0 rgba(255,179,71,.4)">?</span>
      <span class="sm" style="position:absolute;align-self:end;padding-bottom:4px">#${it.index}</span>
    </div>`;
  }
  const tier = it.rarity && it.rarity.tier;
  const border = tier && RARITY_COLOR[tier] ? RARITY_COLOR[tier] : "var(--acc)";
  return `<a href="?view=nft&asset=${esc(it.asset)}" style="border:1px solid ${border};aspect-ratio:1;display:block;overflow:hidden;position:relative;text-decoration:none">
    <img src="${esc(imgUrl(it.inscriptionSig))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;image-rendering:pixelated">
    <span class="sm" style="position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.8);padding:1px 5px">#${it.index}</span>
    ${tier ? `<span class="sm" style="position:absolute;right:4px;top:4px;background:rgba(0,0,0,.8);padding:1px 5px;color:${border}">${esc(tier)}</span>` : ""}
  </a>`;
}

// ── mint panel + flow ───────────────────────────────────────────────────────
async function paintMintPanel(root) {
  const el = root.querySelector("#nc_mint");
  if (!el || !st.col) return;
  const col = st.col;
  const soldOut = col.minted >= col.maxSupply;
  const notOpen = col.startAt && col.startAt * 1000 > Date.now();
  const ended = col.endAt && col.endAt * 1000 < Date.now();
  const { pendingMint } = await import("../../chain/nft.js");
  const resume = pendingMint(col.slug);
  el.innerHTML = `
    <div class="kv sm"><span>price</span><span style="color:var(--acc)">${col.priceLamports ? fmtSol(col.priceLamports) : "FREE"}</span></div>
    ${col.depositLamports ? `<div class="kv sm"><span>deposit (non-refundable, counts toward price)</span><span>${fmtSol(col.depositLamports)}</span></div>` : ""}
    <div class="kv sm"><span>on-chain cost (inscription + rent)</span><span>~0.0135 SOL</span></div>
    <div class="kv sm" style="border-bottom:none"><span>assignment</span><span>${col.sequential ? "sequential" : "random (committed shuffle)"}</span></div>
    ${col.allowlistOnly ? '<div class="sm" style="margin-top:8px;color:var(--cta)">allowlist only</div>' : ""}
    ${resume ? '<div class="sm" style="margin-top:10px;border:1px solid var(--acc);padding:8px">Unfinished mint found; only the missing steps are redone.</div>' : ""}
    <button class="cta" id="nc_mintbtn" style="width:100%;margin-top:12px;text-align:center" ${soldOut || notOpen || ended ? "disabled" : ""}>
      ${soldOut ? "SOLD OUT" : notOpen ? "NOT OPEN YET" : ended ? "MINT ENDED" : !addr() ? "CONNECT WALLET" : resume ? "RESUME MINT" : "MINT"}
    </button>
    <div class="sm" style="margin-top:8px">One wallet approval funds the whole mint; the leftover sweeps back. Your art and metadata become inscriptions owned by your wallet.</div>`;
  const btn = el.querySelector("#nc_mintbtn");
  btn.onclick = async () => {
    if (st.minting) return;
    try {
      if (!addr()) { await connectWallet(); paintWalletPill(root.querySelector("#nf_wallet"), () => paintMintPanel(root)); return paintMintPanel(root); }
      await runMint(root);
    } catch (e) { alert(e.message); }
  };
}

const STAGE_LINES = {
  funding: ["5", "funding the burner (approve one transfer)"],
  deposit: ["15", "paying the deposit"],
  reserve: ["20", "reserving your item"],
  image: ["25", "inscribing the artwork on Solana"],
  metadata: ["80", "inscribing the metadata"],
  register: ["90", "registering the NFT (backend co-sign)"],
  confirming: ["95", "confirming on chain"],
};

async function runMint(root) {
  st.minting = true;
  const modal = root.querySelector("#nf_modal");
  const paint = (pct, label, extraHtml = "") => {
    modal.innerHTML = `
<div style="position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.88);display:flex;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto">
  <div class="win" style="width:640px;max-width:100%;background:var(--bg)">
    <div class="wh"><span>mint.exe · ${esc(st.col.name)}</span></div>
    <div style="padding:20px 22px">
      <div class="sm" id="ncm_label">${esc(label)}</div>
      <div style="margin-top:12px;border:1px solid var(--acc);padding:3px"><div id="ncm_bar" style="height:14px;background:var(--acc);width:${pct}%"></div></div>
      <div class="sm" style="margin-top:10px">Keep this tab open. Interrupted? Reopen this page and press RESUME MINT: every step is checkpointed and nothing is paid twice.</div>
      ${extraHtml}
    </div>
  </div>
</div>`;
  };
  paint(2, "starting");
  try {
    const connection = rpcConnect();
    const burner = await ensureBurner();
    const { mint } = await import("../../chain/nft.js");
    const result = await mint({
      connection, wallet: session.wallet, burner, slug: st.col.slug, collection: st.col,
      onStage: (s, x) => {
        const line = STAGE_LINES[s];
        if (line) paint(Number(line[0]), line[1] + (s === "image" && x ? " · " + (x.name || "#" + x.index) : ""));
      },
      onProgress: (p) => {
        const bar = modal.querySelector("#ncm_bar"), lab = modal.querySelector("#ncm_label");
        if (bar) bar.style.width = (25 + Math.round(p * 0.55)) + "%";
        if (lab) lab.textContent = "inscribing the artwork on Solana · " + Math.round(p) + "%";
      },
    });
    modal.innerHTML = `
<div style="position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.88);display:flex;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto">
  <div class="win" style="width:640px;max-width:100%;background:var(--bg)">
    <div class="wh"><span>mint.exe · ${esc(st.col.name)}</span><span class="lnk ncm_close" style="padding:0 8px">x</span></div>
    <div style="padding:20px 22px;text-align:center">
      <img src="${esc(imgUrl(result.C))}" alt="" style="max-height:220px;margin:0 auto;border:1px solid var(--acc)">
      <div class="hero" style="font-size:36px;margin-top:14px">Minted.</div>
      <div class="big" style="margin-top:6px">${esc(result.name || st.col.name + " #" + result.index)}</div>
      <div class="sm" style="margin-top:10px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a class="cta" style="font-size:16px;padding:8px 14px" href="?view=nft&asset=${esc(result.asset)}">VIEW NFT</a>
        <a href="${esc(explorerTx(result.C))}" target="_blank" rel="noopener" style="align-self:center">image tx</a>
        <a href="${esc(explorerTx(result.M))}" target="_blank" rel="noopener" style="align-self:center">metadata tx</a>
      </div>
    </div>
  </div>
</div>`;
    for (const x of modal.querySelectorAll(".ncm_close")) x.onclick = () => { modal.innerHTML = ""; };
    // refresh the page data (grid cell lights up, counts move)
    nft.collection(st.col.slug).then((c) => { st.col = c; st.offset = 0; st.items = []; loadItems(root); paintMintPanel(root); }).catch(() => {});
  } catch (e) {
    paint(0, "", `<div class="sm" style="color:var(--bad);margin-top:8px">${esc(String((e && e.message) || e))}</div>
      <div style="display:flex;gap:10px;margin-top:12px"><button class="cta ncm_retry" style="font-size:16px;padding:8px 14px">RETRY (resumes where it stopped)</button><span class="lnk ncm_close sm" style="align-self:center">close</span></div>`);
    const label = modal.querySelector("#ncm_label"); if (label) label.textContent = "the mint paused";
    for (const x of modal.querySelectorAll(".ncm_close")) x.onclick = () => { modal.innerHTML = ""; };
    const r = modal.querySelector(".ncm_retry"); if (r) r.onclick = () => { st.minting = false; runMint(root); };
  }
  st.minting = false;
}
