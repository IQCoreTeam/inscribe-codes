// Token side (Board v5): markets.exe + the launch-a-token flow.
// Launch = (1) stage content: type text, drop an image/file, or pick an
// inscription you already own; (2) inscribe it (one funding signature, burner
// writes); (3) name it; metadata JSON is inscribed too, then pump.fun creates
// the coin whose uri points at the on-chain JSON. A kind=token feed row makes
// the coin list in Markets here and on the iqlabs.dev board.
import { type, typeLabels } from "../../ui/tty.js";
import { esc, fmtUsd, fmtPct, fmtWhen, shortAddr } from "../../ui/fmt.js";
import { readTokens, readMine, notify, imgUrl, renderUrl, metaUrl } from "../../services/gateway.js";
import { marketRows, tradeUrl, tradeLabel } from "../../services/markets.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { estimateCost } from "../../chain/burner.js";

// Encoded row cap for the in-browser path; bigger files go through the SDK.
const CAP_KB = 256;
const SDK_DOCS = "https://iqlabs.mintlify.app/docs-typescript";

const st = {
  wallet: null, burner: null,
  open: false, tab: "text", phase: "menu",
  text: "", staged: null, picked: null, // staged: {kind, body, label, bytes}; picked: feed row
  srcSig: null, srcKind: null, srcBody: null,
  name: "", symbol: "", desc: "", devBuy: 0, xlink: "",
  result: null, error: null, progress: 0, stepLabel: "",
  coins: [], priced: {}, mine: null,
};

export async function mount(root) {
  root.innerHTML = `
<div style="max-width:1280px;margin:0 auto;padding:20px 16px 80px">
  <div class="sm" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      <a href="?view=home">&larr; HOME</a><a href="?view=nft">NFT LAUNCHPAD</a>
      <a href="https://iqlabs.dev/?menu=codein" target="_blank" rel="noopener">IQ BOARD</a>
    </div>
    <div style="display:flex;gap:16px;align-items:center">
      <span class="chip live">SOLANA</span>
      <span class="chip soon" title="Robinhood launch is being ported from iqlabs.dev">ROBINHOOD · SOON</span>
      <span id="tk_wallet"></span>
    </div>
  </div>

  <div class="win">
    <div class="wh"><span data-tty>Markets</span><span class="sm" id="tk_count"></span></div>
    <div style="display:flex;gap:18px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--acc);flex-wrap:wrap">
      <div style="flex:1 1 260px;min-width:0">
        <div class="hero" style="font-size:22px" data-tty>Launch a token from an on-chain inscription.</div>
        <div class="sm" style="margin-top:4px;font-size:13px;line-height:1.6">Inscribe an image, text, anything, or pick one you already own. Name it, launch it. The coin page links back to the original forever.</div>
      </div>
      <button class="cta" id="tk_open">&rarr; Launch a token</button>
    </div>
    <div id="tk_cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:12px;padding:14px"><span class="sm">reading launches from the feed...</span></div>
    <p class="sm" style="margin:0;padding:10px 14px;border-top:1px solid var(--line)">Tokens launched from the feed, biggest first. Prices refresh every 30 seconds; new launches show "indexing" for a few minutes.</p>
  </div>
</div>
<div id="tk_modal"></div>`;

  typeLabels(root);
  wireWallet(root);
  root.querySelector("#tk_open").onclick = () => { st.open = true; st.phase = "menu"; st.error = null; paintModal(root); };

  await loadCoins(root);
  const timer = setInterval(() => loadCoins(root).catch(() => {}), 30000);
  return () => clearInterval(timer);
}

async function wireWallet(root) {
  const el = root.querySelector("#tk_wallet");
  const { restore, connect, current } = await import("../../chain/wallets.js");
  st.connectWallet = async () => { st.wallet = await connect(); paintWallet(el); paintModal(root); };
  const paintWallet = () => {
    const w = current();
    st.wallet = w;
    el.innerHTML = w ? "<span>" + esc(shortAddr(w.publicKey.toBase58())) + "</span>" : '<span class="lnk">Connect wallet</span>';
    if (!w) el.querySelector(".lnk").onclick = () => st.connectWallet().catch((e) => alert(e.message));
  };
  paintWallet();
  restore().then((w) => { if (w) { st.wallet = w; paintWallet(); paintModal(root); } });
}

// ---------- markets ----------

async function loadCoins(root) {
  const coins = await readTokens(30);
  st.coins = coins;
  if (coins.length) {
    const priced = await marketRows("solana", coins.map((c) => c.mint));
    st.priced = Object.fromEntries(priced.map((p) => [p.mint, p]));
  }
  paintCards(root);
}

function paintCards(root) {
  const el = root.querySelector("#tk_cards");
  if (!el || !root.isConnected) return; // the view was unmounted mid-load
  root.querySelector("#tk_count").textContent = st.coins.length + " LAUNCHED";
  if (!st.coins.length) { el.innerHTML = '<span class="sm">no launches yet. be the first.</span>'; return; }
  const sorted = st.coins.slice().sort((a, b) => ((st.priced[b.mint] || {}).mcap || 0) - ((st.priced[a.mint] || {}).mcap || 0));
  el.innerHTML = sorted.map((c) => {
    const p = st.priced[c.mint] || {};
    const icon = p.icon || (c.src ? imgUrl(c.src) : "");
    return `<div class="tkcard" data-mint="${esc(c.mint)}" style="border:1px solid var(--line);cursor:pointer">
      <div style="aspect-ratio:1;overflow:hidden;background:var(--panel);position:relative">
        ${icon ? `<img src="${esc(icon)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;image-rendering:pixelated">` : ""}
        ${p.chg24 != null ? `<span class="sm" style="position:absolute;left:6px;top:6px;background:rgba(0,0,0,.85);padding:2px 6px;color:${p.chg24 >= 0 ? "var(--acc)" : "var(--bad)"}">${fmtPct(p.chg24)}</span>` : ""}
      </div>
      <div style="padding:9px 10px 10px">
        <div class="big" style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name || "")}</div>
        <div class="sm">$${esc(c.symbol || "?")}</div>
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:baseline"><span class="hero" style="font-size:20px">${p.mcap ? fmtUsd(p.mcap) : "..."}</span><span class="sm">MC</span></div>
        <div class="sm" style="margin-top:4px;color:${p.mcap ? "var(--mut)" : "var(--cta)"}">${p.mcap ? esc(p.via || "") : "indexing"}</div>
      </div>
    </div>`;
  }).join("");
  for (const card of el.querySelectorAll(".tkcard")) card.onclick = () => openChart(root, card.dataset.mint);
}

function openChart(root, mint) {
  const c = st.coins.find((x) => x.mint === mint) || {};
  const p = st.priced[mint] || {};
  const modal = root.querySelector("#tk_modal");
  modal.innerHTML = `
<div class="tk_backdrop" style="position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.88);display:flex;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto">
  <div class="win" style="width:900px;max-width:100%">
    <div class="wh"><span>chart.exe · $${esc(c.symbol || "?")}</span><span class="lnk tk_close" style="padding:0 8px">x</span></div>
    <div style="padding:14px">
      ${p.embed ? `<iframe src="${esc(p.embed)}" style="width:100%;height:480px;border:1px solid var(--line);background:var(--panel)"></iframe>` : `<div class="sm" style="padding:30px;text-align:center">No chart yet: the pool is still indexing. Check back in a few minutes.</div>`}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px" class="sm">
        <a class="cta" style="font-size:16px;padding:8px 14px" href="${esc(tradeUrl("solana", mint))}" target="_blank" rel="noopener">${tradeLabel("solana")}</a>
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="align-self:center">${esc(p.siteLabel || "open chart site")}</a>` : ""}
        ${c.src ? `<a href="${esc(imgUrl(c.src))}" target="_blank" rel="noopener" style="align-self:center">on-chain original</a>` : ""}
        <span style="align-self:center;color:var(--mut)">${esc(mint)}</span>
      </div>
    </div>
  </div>
</div>`;
  wireModalClose(modal);
}

// ---------- launch layer ----------

const TABS = [
  ["text", "TEXT"], ["image", "IMAGE"], ["file", "FILE"], ["pick", "MY INSCRIPTIONS"],
];
const BLURBS = {
  text: ["Write it straight onto Solana.", "A sentence, a manifesto, a shitpost. The coin links back to it forever."],
  image: ["Put the image itself on chain.", "No IPFS, no server. The bytes live in transactions and the coin points at them."],
  file: ["Any file, on chain.", "Up to " + CAP_KB + " KB in the browser; bigger files go through the SDK."],
  pick: ["Launch from something you already own.", "Anything you inscribed on inscribe.codes or iqlabs.dev shows up here."],
};

function paintModal(root) {
  const modal = root.querySelector("#tk_modal");
  if (!modal || !root.isConnected) return;
  if (!st.open) { modal.innerHTML = ""; return; }
  const body =
    st.phase === "menu" ? menuHtml() :
    st.phase === "inscribing" || st.phase === "launching" ? progressHtml() :
    st.phase === "form" ? formHtml() :
    doneHtml();
  modal.innerHTML = `
<div class="tk_backdrop" style="position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.88);display:flex;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto">
  <div class="win" style="width:780px;max-width:100%">
    <div class="wh"><span>Launch a token</span><span class="sm">${st.phase === "menu" ? "step 1 of 2" : st.phase === "form" ? "step 2 of 2" : ""}</span><span class="lnk tk_close" style="padding:0 8px">x</span></div>
    <div style="padding:20px 22px 22px">${body}</div>
  </div>
</div>`;
  wireModalClose(modal, st.phase === "inscribing" || st.phase === "launching");
  wireModalEvents(root, modal);
}

function menuHtml() {
  const tabs = TABS.map(([id, label]) =>
    `<button class="tk_tab chip ${st.tab === id ? "live" : ""}" data-tab="${id}" style="padding:8px 12px;font-size:12px">${label}</button>`).join("");
  const [title, blurb] = BLURBS[st.tab];
  let content = "";
  if (st.tab === "text") {
    content = `<textarea id="tk_text" placeholder="gm. on-chain forever." style="width:100%;box-sizing:border-box;min-height:120px;resize:vertical;background:var(--bg);color:var(--acc);border:1px solid var(--acc);font:400 20px/1.7 'Jersey 15',monospace;padding:14px;outline:none">${esc(st.text)}</textarea>`;
  } else if (st.tab === "image" || st.tab === "file") {
    const staged = st.staged && st.staged.tab === st.tab ? st.staged : null;
    content = `<label style="display:flex;flex-direction:column;align-items:center;gap:8px;border:1px dashed var(--acc);padding:26px;text-align:center;cursor:pointer">
      <span class="sm" style="font-size:13px">${staged ? esc(staged.label) : st.tab === "image" ? "Select an image (PNG / JPG / WEBP / GIF)" : "Select any file"}</span>
      <span class="sm">You see the cost before anything is paid.</span>
      <input id="tk_file" type="file" ${st.tab === "image" ? 'accept="image/*"' : ""} style="display:none">
    </label>
    ${staged && staged.kind === "image" ? `<img src="${staged.body}" alt="" style="margin-top:10px;max-height:160px;border:1px solid var(--line)">` : ""}
    <div class="sm" style="margin-top:8px">File too big? <a href="${SDK_DOCS}" target="_blank" rel="noopener">upload large files from the terminal</a></div>`;
  } else {
    content = st.wallet
      ? `<div id="tk_minelist" class="sm">loading your inscriptions...</div>`
      : `<div class="sm" style="border:1px dashed var(--acc);padding:22px;text-align:center">Connect your wallet to see what you have saved. Anything from inscribe.codes or iqlabs.dev shows up here.<br><br><span class="lnk" id="tk_connect2">Connect wallet</span></div>`;
  }
  const est = currentEstimate();
  const details = est ? `
    <div style="margin-top:12px;border:1px solid var(--line)" class="sm">
      <div class="kv" style="padding:6px 12px"><span>size</span><span>${(est.bytes / 1024).toFixed(1)} KB</span></div>
      <div class="kv" style="padding:6px 12px"><span>parts</span><span>${est.chunks} chunk${est.chunks > 1 ? "s" : ""}</span></div>
      <div class="kv" style="padding:6px 12px"><span>you pay up to</span><span style="color:var(--acc)">${(est.total / 1e9).toFixed(4)} SOL (leftover sweeps back)</span></div>
    </div>` : "";
  const ready = hasContent();
  return `
    <div style="position:relative;margin-bottom:12px;border:1px solid var(--line);background:var(--panel);padding:18px 16px">
      <div class="hero" style="font-size:26px">${esc(title)}</div>
      <p class="sm" style="font-size:13px;line-height:1.6;max-width:58ch">${esc(blurb)}</p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${tabs}</div>
    <div style="margin-top:12px">${content}</div>
    <div id="tk_est">${st.tab === "pick" ? "" : details}</div>
    ${st.error ? `<div class="sm" style="margin-top:10px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <button id="tk_go" class="cta" style="width:100%;margin-top:14px;text-align:center" ${ready || !st.wallet ? "" : "disabled"}>${!st.wallet ? "CONNECT WALLET" : st.picked ? "CONTINUE WITH PICK" : "CONTINUE"}</button>
    ${st.picked ? `<div class="sm" style="margin-top:8px;text-align:center">Using ${esc(st.picked.kind)} · ${esc(shortAddr(st.picked.__txSignature))} · <span class="lnk" id="tk_clearpick">start fresh instead</span></div>` : ""}`;
}

function progressHtml() {
  return `
    <div class="hero" style="font-size:24px">${st.phase === "inscribing" ? "Writing to chain..." : "Launching..."}</div>
    <div class="sm" style="margin-top:10px">${esc(st.stepLabel || "preparing")}</div>
    <div style="margin-top:14px;border:1px solid var(--acc);padding:3px"><div style="height:14px;background:var(--acc);width:${st.progress}%"></div></div>
    <div class="sm" style="margin-top:10px">Keep this tab open. One wallet approval funds a burner key; everything else signs itself, and leftover sweeps back to your wallet.</div>`;
}

function formHtml() {
  const devBuy = Number(st.devBuy) || 0;
  return `
    <div class="big" data-tty>Step 2 of 2: name it and launch</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <div style="flex:1"><div class="sm">Name</div><input id="tk_name" value="${esc(st.name)}" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
      <div style="flex:0 0 140px"><div class="sm">Symbol</div><input id="tk_sym" value="${esc(st.symbol)}" maxlength="10" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
    </div>
    <div class="sm" style="margin-top:10px">Description</div>
    <textarea id="tk_desc" style="width:100%;box-sizing:border-box;min-height:54px;resize:vertical;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:16px;padding:9px 10px">${esc(st.desc)}</textarea>
    <div style="display:flex;gap:10px;margin-top:10px">
      <div style="flex:0 0 180px"><div class="sm">Initial dev buy (SOL)</div><input id="tk_buy" value="${st.devBuy || ""}" placeholder="0" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
      <div style="flex:1"><div class="sm">X link (optional)</div><input id="tk_x" value="${esc(st.xlink)}" placeholder="https://x.com/..." style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
    </div>
    <div style="margin-top:12px;border:1px solid var(--line)" class="sm">
      <div class="kv" style="padding:6px 12px"><span>platform fee</span><span>0.069 SOL</span></div>
      <div class="kv" style="padding:6px 12px"><span>dev buy</span><span>${devBuy} SOL</span></div>
      <div class="kv" style="padding:6px 12px"><span>total</span><span style="color:var(--acc)">~${(0.069 + devBuy + 0.003).toFixed(3)} SOL</span></div>
    </div>
    <div class="sm" style="margin-top:8px">Fees stream to token holders (holder-rewards coin). If the launch does not go through, the platform fee is not charged.</div>
    ${st.error ? `<div class="sm" style="margin-top:10px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <button id="tk_launch" class="cta" style="width:100%;margin-top:12px;text-align:center">Launch on pump.fun</button>
    <div class="sm lnk" id="tk_back" style="margin-top:10px;text-align:center">&larr; back</div>`;
}

function doneHtml() {
  const r = st.result;
  return `
    <div style="text-align:center;padding:16px 0 4px">
      <div class="hero" style="font-size:48px" data-tty>Launched.</div>
      <div class="big" style="margin-top:12px">$${esc(st.symbol)} · ${esc(st.name)}</div>
      <div class="sm" style="margin-top:8px">mint: ${esc(r.mint)}<br>a kind=token row was inscribed, so it shows in Markets and on the iqlabs.dev board</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px" class="sm">
      <a class="cta" style="font-size:16px;padding:10px 16px" href="${esc(tradeUrl("solana", r.mint))}" target="_blank" rel="noopener">View on pump.fun</a>
      <a href="${esc(explorerTx(r.sig))}" target="_blank" rel="noopener" style="align-self:center">launch tx</a>
      <span class="lnk tk_close" style="align-self:center">open markets</span>
    </div>`;
}

// ---------- wiring + flow ----------

function wireModalClose(modal, locked) {
  for (const el of modal.querySelectorAll(".tk_close")) el.onclick = () => { st.open = false; modal.innerHTML = ""; };
  const back = modal.querySelector(".tk_backdrop");
  if (back && !locked) back.onclick = (e) => { if (e.target === back) { st.open = false; modal.innerHTML = ""; } };
}

function wireModalEvents(root, modal) {
  for (const b of modal.querySelectorAll(".tk_tab")) b.onclick = () => { st.tab = b.dataset.tab; st.error = null; paintModal(root); if (st.tab === "pick") loadMine(root); };
  const text = modal.querySelector("#tk_text");
  if (text) { text.oninput = () => { st.text = text.value; st.picked = null; refreshEstimate(root, modal); }; text.focus(); }
  const file = modal.querySelector("#tk_file");
  if (file) file.onchange = () => stageFile(root, file.files[0]);
  const c2 = modal.querySelector("#tk_connect2");
  if (c2) c2.onclick = () => st.connectWallet().then(() => { paintModal(root); loadMine(root); }).catch((e) => alert(e.message));
  const clear = modal.querySelector("#tk_clearpick");
  if (clear) clear.onclick = () => { st.picked = null; paintModal(root); };
  const go = modal.querySelector("#tk_go");
  if (go) go.onclick = () => (st.wallet ? startInscribe(root) : st.connectWallet().then(() => paintModal(root)).catch((e) => alert(e.message)));
  const launch = modal.querySelector("#tk_launch");
  if (launch) launch.onclick = () => readForm(modal) && startLaunch(root);
  const back = modal.querySelector("#tk_back");
  if (back) back.onclick = () => { readForm(modal); st.phase = "menu"; paintModal(root); };
  if (st.tab === "pick" && st.wallet && st.phase === "menu") loadMine(root);
}

// Re-render only the cost box while typing (a full repaint would drop focus).
function refreshEstimate(root, modal) {
  const go = modal.querySelector("#tk_go");
  if (go && st.wallet) go.toggleAttribute("disabled", !hasContent());
  const box = modal.querySelector("#tk_est");
  const est = currentEstimate();
  if (box) box.innerHTML = !est ? "" : `
    <div style="margin-top:12px;border:1px solid var(--line)" class="sm">
      <div class="kv" style="padding:6px 12px"><span>size</span><span>${(est.bytes / 1024).toFixed(1)} KB</span></div>
      <div class="kv" style="padding:6px 12px"><span>parts</span><span>${est.chunks} chunk${est.chunks > 1 ? "s" : ""}</span></div>
      <div class="kv" style="padding:6px 12px"><span>you pay up to</span><span style="color:var(--acc)">${(est.total / 1e9).toFixed(4)} SOL (leftover sweeps back)</span></div>
    </div>`;
}

function readForm(modal) {
  st.name = (modal.querySelector("#tk_name") || {}).value || st.name;
  st.symbol = ((modal.querySelector("#tk_sym") || {}).value || st.symbol).toUpperCase().trim();
  st.desc = (modal.querySelector("#tk_desc") || {}).value ?? st.desc;
  st.devBuy = parseFloat((modal.querySelector("#tk_buy") || {}).value) || 0;
  st.xlink = ((modal.querySelector("#tk_x") || {}).value || "").trim();
  if (!st.name.trim() || !st.symbol) { st.error = "name and symbol are required"; return false; }
  st.error = null;
  return true;
}

const hasContent = () =>
  !!st.picked || (st.tab === "text" ? st.text.trim().length > 0 : st.staged && st.staged.tab === st.tab);

function currentEstimate() {
  let bytes = 0;
  if (st.tab === "text" && st.text.trim()) bytes = new TextEncoder().encode(st.text).length + 80;
  else if (st.staged && st.staged.tab === st.tab) bytes = st.staged.bytes;
  else return null;
  return { bytes, ...estimateCost(bytes) };
}

function stageFile(root, f) {
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const body = reader.result;
    const kb = new TextEncoder().encode(body).length / 1024;
    if (kb > CAP_KB) { st.error = f.name + " is " + kb.toFixed(0) + " KB encoded; the browser cap is " + CAP_KB + " KB. Use the SDK for big files."; st.staged = null; }
    else { st.error = null; st.picked = null; st.staged = { tab: st.tab, kind: st.tab === "image" || f.type.startsWith("image/") ? "image" : "file", body, label: f.name + " · " + kb.toFixed(0) + " KB", bytes: Math.ceil(kb * 1024) }; }
    paintModal(root);
  };
  reader.readAsDataURL(f);
}

async function loadMine(root) {
  const modal = root.querySelector("#tk_modal");
  const el = modal.querySelector("#tk_minelist");
  if (!el || !st.wallet) return;
  if (!st.mine) {
    try { st.mine = (await readMine(st.wallet.publicKey.toBase58(), 30)).rows.filter((r) => r.kind !== "token"); }
    catch (e) { el.textContent = "could not load your inscriptions: " + e.message; return; }
  }
  if (!st.mine.length) { el.innerHTML = '<div style="text-align:center;padding:16px 0"><div class="big">Nothing saved yet</div><p class="sm">Upload an image first. It is saved on chain, then you come straight back here to launch it.</p></div>'; return; }
  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:236px;overflow-y:auto">' + st.mine.map((r, i) => {
    const isImg = typeof r.body === "string" && r.body.startsWith("data:image/");
    return `<div class="tk_pickit" data-i="${i}" style="border:1px solid ${st.picked === r ? "var(--acc)" : "var(--line)"};cursor:pointer">
      <div style="aspect-ratio:7/4;overflow:hidden;background:var(--panel);display:grid;place-items:center">${isImg ? `<img src="${r.body}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span class="sm">${esc(r.kind)}</span>`}</div>
      <div style="padding:7px 9px" class="sm"><span class="chip" style="padding:1px 6px">${esc(r.kind)}</span> ${fmtWhen(r.__blockTime)}<div style="margin-top:4px">${esc(shortAddr(r.__txSignature || ""))}</div></div>
    </div>`;
  }).join("") + "</div>";
  for (const it of el.querySelectorAll(".tk_pickit")) it.onclick = () => { st.picked = st.mine[Number(it.dataset.i)]; st.staged = null; paintModal(root); };
}

async function startInscribe(root) {
  if (!hasContent()) return;
  if (st.picked) {
    st.srcSig = st.picked.__txSignature;
    st.srcKind = st.picked.kind;
    st.srcBody = st.picked.body;
    st.phase = "form";
    return paintModal(root);
  }
  const kind = st.tab === "text" ? "text" : st.staged.kind;
  const body = st.tab === "text" ? st.text : st.staged.body;
  st.phase = "inscribing"; st.progress = 2; st.stepLabel = "deriving your burner key (one signature)"; st.error = null;
  paintModal(root);
  try {
    const connection = rpcConnect();
    const burner = await ensureBurner(connection);
    st.stepLabel = "funding + writing to chain"; st.progress = 10; paintModal(root);
    const { inscribeRow } = await import("../../chain/feed.js");
    const { sig } = await inscribeRow({
      connection, wallet: st.wallet, burner, kind, body, speed: "light",
      onProgress: (p) => { st.progress = 10 + Math.round(p * 0.85); const bar = root.querySelector("#tk_modal .win div[style*='height:14px']"); if (bar) bar.style.width = st.progress + "%"; },
      onRetry: () => { st.stepLabel = "paused, retrying (funds are safe in your burner)"; paintModal(root); },
    });
    notify(sig, { kind, body, who: st.wallet.publicKey.toBase58() });
    st.srcSig = sig; st.srcKind = kind; st.srcBody = body; st.mine = null;
    st.phase = "form";
  } catch (e) {
    st.phase = "menu";
    st.error = String(e && e.message || e);
  }
  paintModal(root);
}

async function ensureBurner(connection) {
  if (st.burner) return st.burner;
  const { deriveBurner } = await import("../../chain/burner.js");
  st.burner = await deriveBurner((m) => st.wallet.signMessage(m));
  return st.burner;
}

async function startLaunch(root) {
  st.phase = "launching"; st.progress = 5; st.stepLabel = "inscribing the coin metadata"; st.error = null;
  paintModal(root);
  try {
    const connection = rpcConnect();
    const burner = await ensureBurner(connection);
    const image = st.srcKind === "image" ? imgUrl(st.srcSig) : renderUrl(st.srcSig);
    const viewLink = "https://iqlabs.dev/?menu=codein&post=" + st.srcSig;
    const meta = {
      name: st.name, symbol: st.symbol,
      description: (st.desc.trim() ? st.desc.trim() + "\n\n" : "") + "fully on-chain: this coin's artwork and metadata are Solana inscriptions. recover them with the IQ SDK from the chain alone. original: " + viewLink,
      image, external_url: viewLink, website: st.xlink || viewLink, showName: true,
      attributes: [
        { trait_type: "inscription tx", value: st.srcSig },
        { trait_type: "inscription kind", value: st.srcKind },
        { trait_type: "rewards", value: "token holders" },
        { trait_type: "storage", value: "fully on-chain (solana code-in)" },
        { trait_type: "feed", value: "iq6900-codein-feed-v1 / global-feed" },
      ],
      properties: { category: "image", files: [{ uri: image, type: "image/png" }] },
    };
    if (st.xlink) meta.twitter = st.xlink;
    // Warm the gateway caches now: pump.fun fetches uri + image with short
    // timeouts, and a cold reassembly (~25s) would cache as a permanent miss.
    try { fetch(image, { mode: "no-cors" }); } catch (e) {}

    const { inscribeMeta, inscribeRow } = await import("../../chain/feed.js");
    const { sig: metaSig } = await inscribeMeta({ connection, wallet: st.wallet, burner, json: JSON.stringify(meta) });
    try { fetch(metaUrl(metaSig), { mode: "no-cors" }); } catch (e) {}
    st.progress = 35; st.stepLabel = "creating the coin on pump.fun"; paintModal(root);

    const { launchOnPump } = await import("../../chain/launch/pumpfun.js");
    const result = await launchOnPump({
      connection, wallet: st.wallet, name: st.name, symbol: st.symbol,
      uri: metaUrl(metaSig), devBuySol: st.devBuy,
      onStep: (label) => { st.stepLabel = label; st.progress = Math.min(90, st.progress + 20); paintModal(root); },
    });
    st.result = result;
    st.progress = 95; st.stepLabel = "recording the launch on the feed"; paintModal(root);
    // The registry row is what lists the coin in Markets and on the board. The
    // coin exists either way, so a failure here is reported, not fatal.
    try {
      const body = JSON.stringify({ mint: result.mint, name: st.name, symbol: st.symbol, src: st.srcSig, meta: metaSig });
      const { sig } = await inscribeRow({ connection, wallet: st.wallet, burner, kind: "token", body, speed: "light" });
      notify(sig, { kind: "token", body, who: st.wallet.publicKey.toBase58() });
    } catch (e) { console.warn("[launch] registry row failed, the coin is live anyway:", e.message); }
    st.phase = "done";
    loadCoins(root).catch(() => {});
  } catch (e) {
    st.phase = "form";
    st.error = String(e && e.message || e);
  }
  paintModal(root);
}
