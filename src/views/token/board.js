// Token side (Board v5): markets.exe + the launch-a-token flow, Solana and
// Robinhood in one page (same structure, different accent + launch venue).
// Launch = (1) stage content: text / ascii / image / file, or pick an
// inscription you already own; (2) inscribe it; (3) name it and launch
// (pump.fun on Solana, Pons on Robinhood). A kind=token feed row lists the
// coin in Markets here and on the iqlabs.dev board.
import { typeLabels } from "../../ui/tty.js";
import { esc, fmtUsd, fmtPct, fmtWhen, shortAddr } from "../../ui/fmt.js";
import { toAscii } from "../../ui/ascii.js";
import { readTokens, readMine, notify, imgUrl, renderUrl, metaUrl } from "../../services/gateway.js";
import { marketRows, tradeUrl, tradeLabel } from "../../services/markets.js";
import { connect as rpcConnect } from "../../chain/rpc.js";
import { estimateCost } from "../../chain/burner.js";
import { nav, paintWalletPill as paintNavWallet } from "../../ui/nav.js";

const CAP_KB = 256; // encoded row cap for the in-browser path; bigger goes via the SDK
const SDK_DOCS = "https://iqlabs.mintlify.app/docs-typescript";

// The only place the two chains differ.
const CHAINS = {
  solana: { label: "SOLANA", market: "solana", venue: "pump.fun", devBuy: true,
    feeLine: [["platform fee", "0.069 SOL"]],
    totalFor: (devBuy) => "~" + (0.069 + devBuy + 0.003).toFixed(3) + " SOL" },
  hood: { label: "ROBINHOOD", market: "robinhood", venue: "Pons", devBuy: false,
    feeLine: [["pons launch fee", "0.0005 ETH"]],
    totalFor: () => "~0.0015 ETH + gas" },
};

const st = {
  chain: "solana",
  sol: { wallet: null, burner: null, mine: null },
  hood: { address: null, mine: null },
  open: false, tab: "text", phase: "menu",
  text: "", staged: null, picked: null,
  ascii: { dataUrl: null, font: 8, spacing: -2, out: "" },
  srcSig: null, srcKind: null,
  name: "", symbol: "", desc: "", devBuy: 0, xlink: "",
  result: null, error: null, progress: 0, stepLabel: "",
  coins: [], priced: {},
};
const ch = () => CHAINS[st.chain];

export async function mount(root) {
  root.innerHTML = `
${nav("token")}
<div id="desk" style="padding:14px 16px 48px">
  <div class="win" id="markets">
    <div class="wh"><span data-tty>Markets</span><span class="wh-right" id="tk_count"></span></div>
    <div style="display:flex;gap:18px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--acc);flex-wrap:wrap">
      <div style="flex:0 0 238px;aspect-ratio:7/3;border:1px solid var(--line);overflow:hidden;background:var(--panel)"><img src="public/img/launch_hero.png" alt="" style="width:100%;height:100%;object-fit:cover"></div>
      <div style="flex:1 1 260px;min-width:0">
        <div class="hero" style="font-size:22px" data-tty>Launch a token from an on-chain inscription.</div>
        <div class="sm" style="margin-top:4px;line-height:1.6">Inscribe an image, text, anything, or pick one you already own. Name it, launch it. The coin page links back to the on-chain original forever.</div>
      </div>
      <button class="cta" id="tk_open" style="flex:0 0 auto">&rarr; Launch a token</button>
    </div>
    <div id="tk_tip" style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:7px 14px;border-bottom:1px solid var(--line)"><span class="sm">Click any token to see its chart.</span><span class="sm lnk" id="tk_tipx" style="padding:0 4px">x</span></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px 10px;border-bottom:1px solid var(--line)"><span class="sm">Recent launches</span><span class="sm">click a card for the chart</span></div>
    <div id="tk_cards" class="ttyrows" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:12px;padding:14px"><span class="sm">reading launches from the feed...</span></div>
    <p class="sm" style="margin:0;padding:10px 14px;border-top:1px solid var(--line)">Tokens launched from the feed, biggest first. Prices refresh every 30 seconds; new launches show "indexing" for a few minutes.</p>
  </div>
</div>
<div id="tk_modal"></div>`;

  typeLabels(root);
  paintChainNav(root);
  wireWallet(root);
  root.querySelector("#tk_open").onclick = () => { st.open = true; st.phase = "menu"; st.error = null; paintModal(root); };
  const tipx = root.querySelector("#tk_tipx");
  if (tipx) tipx.onclick = () => { const t = root.querySelector("#tk_tip"); if (t) t.remove(); };

  await loadCoins(root);
  const timer = setInterval(() => loadCoins(root).catch(() => {}), 30000);
  return () => { clearInterval(timer); document.body.removeAttribute("data-net"); };
}

function paintChainNav(root) {
  if (st.chain === "hood") document.body.setAttribute("data-net", "hood");
  else document.body.removeAttribute("data-net");
  const slot = root.querySelector("#nav_chain");
  if (!slot) return;
  const other = st.chain === "solana" ? "hood" : "solana";
  slot.innerHTML = `<button class="navbtn2" id="tk_chain">${other === "hood" ? "Robinhood chain" : "Solana chain"} &rarr;</button>`;
  slot.querySelector("#tk_chain").onclick = () => switchChain(root, other);
}

function switchChain(root, chain) {
  if (st.chain === chain) return;
  st.chain = chain;
  st.open = false; st.picked = null; st.staged = null;
  st.sol.mine = null; st.hood.mine = null;
  st.coins = []; st.priced = {};
  paintChainNav(root);
  paintWalletPill(root);
  root.querySelector("#tk_modal").innerHTML = "";
  root.querySelector("#tk_cards").innerHTML = '<span class="sm">reading launches from the feed...</span>';
  loadCoins(root).catch(() => {});
}

// ── wallets (per chain) ─────────────────────────────────────────────────────
async function wireWallet(root) {
  const sol = await import("../../chain/wallets.js");
  st.connectWallet = async () => {
    if (st.chain === "solana") st.sol.wallet = await sol.connect();
    else { const { connectEvm } = await import("../../chain/evm.js"); st.hood.address = await connectEvm(); }
    paintWalletPill(root); paintModal(root);
  };
  paintWalletPill(root);
  sol.restore().then((w) => { if (w) { st.sol.wallet = w; paintWalletPill(root); paintModal(root); } });
  import("../../chain/evm.js").then(({ connectEvm }) => connectEvm({ silent: true }).then((a) => { if (a) { st.hood.address = a; paintWalletPill(root); } }).catch(() => {}));
}

const walletAddr = () => (st.chain === "solana" ? (st.sol.wallet ? st.sol.wallet.publicKey.toBase58() : null) : st.hood.address);

const paintWalletPill = (root) => paintNavWallet(root.querySelector("#nav_wallet"), walletAddr(), st.connectWallet);

// ── markets ─────────────────────────────────────────────────────────────────
async function loadCoins(root) {
  const chain = st.chain;
  let coins;
  if (chain === "solana") coins = await readTokens(30);
  else { const { readEvmTokens } = await import("../../chain/evm.js"); coins = await readEvmTokens(30); }
  if (st.chain !== chain) return; // switched away mid-load
  st.coins = coins;
  if (coins.length) {
    const priced = await marketRows(CHAINS[chain].market, coins.map((c) => c.mint));
    if (st.chain !== chain) return;
    st.priced = Object.fromEntries(priced.map((p) => [p.mint, p]));
  } else st.priced = {};
  paintCards(root);
}

function paintCards(root) {
  const el = root.querySelector("#tk_cards");
  if (!el || !root.isConnected) return;
  root.querySelector("#tk_count").textContent = st.coins.length + " LAUNCHED · " + ch().label;
  if (!st.coins.length) { el.innerHTML = '<span class="sm">no launches yet on ' + ch().label.toLowerCase() + '. be the first.</span>'; return; }
  const sorted = st.coins.slice().sort((a, b) => ((st.priced[b.mint] || {}).mcap || 0) - ((st.priced[a.mint] || {}).mcap || 0));
  el.innerHTML = sorted.map((c) => {
    const p = st.priced[c.mint] || {};
    const live = (p.mcap || 0) > 0;
    return `<div class="flick tkcard" data-mint="${esc(c.mint)}" style="border:1px solid ${live ? "var(--acc)" : "var(--line)"};background:var(--panel);cursor:pointer">
      <div style="aspect-ratio:1;overflow:hidden;background:var(--panel);position:relative">
        ${p.icon ? `<img src="${esc(p.icon)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;image-rendering:pixelated">` : `<div class="hero" style="display:grid;place-items:center;height:100%;font-size:28px;color:var(--mut)">$${esc((c.symbol || "?").slice(0, 6))}</div>`}
        ${p.chg24 != null ? `<span class="chip live" style="position:absolute;left:6px;top:6px;background:rgba(0,0,0,.85);color:${p.chg24 >= 0 ? "var(--acc)" : "var(--bad)"}">${fmtPct(p.chg24)}</span>` : ""}
      </div>
      <div style="padding:9px 10px 10px">
        <div style="color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:400 16px 'Jersey 15',monospace">${esc(c.name || "")}</div>
        <div class="sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">$${esc(c.symbol || "?")}</div>
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:baseline"><span class="hero" style="font-size:22px">${live ? fmtUsd(p.mcap) : "..."}</span><span class="sm">MC</span></div>
        <div class="sm" style="margin-top:6px">${p.priceUsd != null ? "$" + Number(p.priceUsd).toPrecision(4) : "&nbsp;"}</div>
        <div class="sm" style="margin-top:4px;color:${live ? "var(--mut)" : "var(--cta)"}">${live ? esc(p.via || "") : "indexing"}</div>
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
  <div class="win" style="width:900px;max-width:100%;background:var(--bg)">
    <div class="wh"><span>chart.exe · $${esc(c.symbol || "?")}</span><span class="lnk tk_close" style="padding:0 8px">x</span></div>
    <div style="padding:14px">
      ${p.embed ? `<iframe src="${esc(p.embed)}" style="width:100%;height:480px;border:1px solid var(--line);background:var(--panel)"></iframe>` : `<div class="sm" style="padding:30px;text-align:center">No chart yet: the pool is still indexing. Check back in a few minutes.</div>`}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px" class="sm">
        <a class="cta" style="font-size:16px;padding:8px 14px" href="${esc(tradeUrl(ch().market, mint))}" target="_blank" rel="noopener">${tradeLabel(ch().market)}</a>
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="align-self:center">${esc(p.siteLabel || "chart site")}</a>` : ""}
        <span style="align-self:center;color:var(--mut)">${esc(mint)}</span>
      </div>
    </div>
  </div>
</div>`;
  wireModalClose(modal);
}

// ── launch layer ────────────────────────────────────────────────────────────
const TABS = [["text", "TEXT"], ["ascii", "ASCII"], ["image", "IMAGE"], ["file", "FILE"], ["pick", "MY INSCRIPTIONS"]];
const STEP = {
  text: { title: "Step 1 of 2: write your text", img: "step_text",
    blurb: "Your token starts as text written to the chain. Type it here; the coin page will show it forever." },
  ascii: { title: "Step 1 of 2: turn an image into ASCII", img: "step_ascii",
    blurb: "Pick an image and we turn it into ASCII art on chain. Tune the font size and spacing, then launch." },
  image: { title: "Step 1 of 2: pick your image", img: "step_image",
    blurb: "Your token needs an image that lives on chain. Upload a new one, or pick one you already saved under My inscriptions." },
  file: { title: "Step 1 of 2: pick your file", img: "step_file",
    blurb: "Any file can back a token. Up to " + CAP_KB + " KB in the browser; bigger files go through the SDK." },
  pick: { title: "Step 1 of 2: choose a saved inscription", img: null,
    blurb: "Everything you already inscribed on inscribe.codes or iqlabs.dev shows up here. Pick one and launch it as a token." },
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
  <div class="win" style="width:780px;max-width:100%;background:var(--bg)">
    <div class="wh"><span>Launch a token · ${ch().label}</span><span class="sm">${st.phase === "menu" ? "step 1 of 2" : st.phase === "form" ? "step 2 of 2" : ""}</span><span class="lnk tk_close" style="padding:0 8px">x</span></div>
    <div style="padding:20px 22px 22px">${body}</div>
  </div>
</div>`;
  wireModalClose(modal, st.phase === "inscribing" || st.phase === "launching");
  wireModalEvents(root, modal);
  typeLabels(modal);
}

// Encoded byte size of whatever is staged on the current tab, or 0.
function stagedBytes() {
  if (st.tab === "text") return st.text.trim() ? new TextEncoder().encode(st.text).length + 80 : 0;
  if (st.tab === "ascii") return st.ascii.out ? new TextEncoder().encode(st.ascii.out).length + 80 : 0;
  return st.staged && st.staged.tab === st.tab ? st.staged.bytes : 0;
}

function sizeLine() {
  const bytes = stagedBytes();
  if (!bytes) return "";
  const kb = (bytes / 1024).toFixed(1) + " KB";
  if (st.chain !== "solana") return kb + " -> 3 signatures (the burner uploads the batches)";
  const e = estimateCost(bytes);
  return kb + " -> " + e.chunks + " chunk" + (e.chunks > 1 ? "s" : "");
}

function detailsHtml() {
  const bytes = stagedBytes();
  if (!bytes) return "";
  const kb = (bytes / 1024).toFixed(1) + " KB";
  const rows = st.chain === "solana"
    ? (() => {
        const e = estimateCost(bytes);
        return [["size", kb], ["parts", e.chunks + " chunk" + (e.chunks > 1 ? "s" : "")],
          ["network fee", (e.network / 1e9).toFixed(5) + " SOL"],
          ["service fee", (e.codeInFee / 1e9).toFixed(5) + " SOL"],
          ["temporary deposit", (e.rent / 1e9).toFixed(5) + " SOL"],
          ["__total", (e.total / 1e9).toFixed(4) + " SOL"]];
      })()
    : [["size", kb], ["wallet signatures", "3 (the burner uploads the batches)"],
       ["__total", (bytes <= 700 ? 0.00024 : 0.00072).toFixed(5) + " ETH + gas"]];
  const body = rows.map(([k, v]) => k === "__total"
    ? `<div class="kv" style="padding:10px 12px 8px;border-top:1px solid var(--line)"><span style="color:var(--ink)">you pay</span><span style="color:var(--acc)">${v}</span></div>`
    : `<div class="kv" style="padding:6px 12px"><span>${k}</span><span style="color:var(--ink2)">${v}</span></div>`).join("");
  return `<details style="margin-top:12px"><summary class="lnk" style="list-style:none;letter-spacing:.1em;padding:6px 0">details &#9656;</summary>
    <div style="margin-top:4px;border:1px solid var(--mut)" class="sm">${body}</div>
    <div class="sm" style="margin-top:10px">Leftover sweeps back to your wallet. File too big? <a href="${SDK_DOCS}" target="_blank" rel="noopener">upload large files from the terminal</a>.</div>
  </details>`;
}

function asciiBox(label, hint, decId, val, incId, note) {
  return `<div style="border:1px solid var(--line);padding:12px 14px">
    <div class="sm" style="display:flex;justify-content:space-between;align-items:baseline"><span>${label}</span><span style="opacity:.6">${hint}</span></div>
    <div style="display:inline-flex;border:1px solid var(--line);overflow:hidden;margin-top:10px;font:400 16px 'Jersey 15',monospace;color:var(--ink)">
      <div id="${decId}" style="width:32px;text-align:center;padding:5px 0;cursor:pointer">-</div>
      <div style="width:46px;text-align:center;padding:5px 0;border-left:1px solid var(--line);border-right:1px solid var(--line);color:var(--acc)">${val}</div>
      <div id="${incId}" style="width:32px;text-align:center;padding:5px 0;cursor:pointer">+</div>
    </div>
    <div class="sm" style="margin-top:8px">${note}</div>
  </div>`;
}

function menuHtml() {
  const tabs = TABS.map(([id, label]) =>
    `<button class="tk_tab chip ${st.tab === id ? "live" : ""}" data-tab="${id}" style="padding:8px 12px;font-size:12px">${label}</button>`).join("");
  const step = STEP[st.tab];
  const dash = "border:1px dashed var(--acc);text-align:center;cursor:pointer;display:block";
  let content = "";
  if (st.tab === "text") {
    content = `<div style="padding:8px;border:1px solid var(--acc);outline:1px dotted var(--acc);outline-offset:3px;background-color:var(--panel2);background-image:radial-gradient(var(--acc) 1px,transparent 1.2px);background-size:5px 5px">
      <textarea id="tk_text" placeholder="gm. on-chain forever." style="width:100%;box-sizing:border-box;min-height:120px;resize:vertical;display:block;background:var(--bg);color:var(--acc);border:1px solid var(--acc);font:400 18px/1.7 'Jersey 15',monospace;padding:14px;outline:none">${esc(st.text)}</textarea>
    </div>`;
  } else if (st.tab === "ascii") {
    content = `
      <label style="${dash};padding:20px">
        <span class="sm" style="font-size:13px">${st.ascii.dataUrl ? "Pick a different image" : "Select image"}</span><br>
        <span class="sm">PNG / JPG / WEBP</span>
        <input id="tk_afile" type="file" accept="image/*" style="display:none">
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        ${asciiBox("Font size", "5 to 50", "tk_fdec", st.ascii.font, "tk_finc", "Smaller packs in more characters.")}
        ${asciiBox("Spacing", "-50 to 50", "tk_sdec", st.ascii.spacing, "tk_sinc", "Distance between characters.")}
      </div>
      ${st.ascii.out ? `<pre style="margin:12px 0 0;border:1px solid var(--line);padding:14px;font:400 7px/1.15 monospace;color:var(--acc);background:var(--panel2);max-height:240px;overflow:auto">${esc(st.ascii.out)}</pre>` : ""}`;
  } else if (st.tab === "image" || st.tab === "file") {
    const staged = st.staged && st.staged.tab === st.tab ? st.staged : null;
    const prompt = staged ? esc(staged.label) : st.tab === "image" ? "Drop an image here" : "Drop any file here";
    content = `<label style="${dash};padding:26px;font:400 14px/1.9 'Jersey 15',monospace;color:var(--mut)">
      ${prompt}${st.tab === "image" ? `<br><span class="sm">You see a preview before anything is paid.</span>` : ""}
      <input id="tk_file" type="file" ${st.tab === "image" ? 'accept="image/*"' : ""} style="display:none">
    </label>
    ${staged && staged.kind === "image" ? `<img src="${staged.body}" alt="" style="margin-top:10px;max-height:160px;border:1px solid var(--line)">` : ""}
    ${st.tab === "file" ? `<a href="${SDK_DOCS}" target="_blank" rel="noopener" style="margin-top:10px;display:flex;justify-content:space-between;border:1px solid #b07a1a;padding:10px 14px;font:400 11px/1.6 'Silkscreen',monospace;color:var(--mut);text-decoration:none"><span>bigger than ${CAP_KB} KB?</span><span style="color:#b07a1a">upload from the terminal -></span></a>` : ""}`;
  } else {
    content = walletAddr()
      ? `<div id="tk_minelist" class="sm">loading your inscriptions...</div>`
      : `<div class="sm" style="border:1px dashed var(--acc);padding:22px;text-align:center">Connect your wallet to see what you have saved. Anything from inscribe.codes or iqlabs.dev shows up here.<br><br><span class="lnk" id="tk_connect2">Connect wallet</span></div>`;
  }
  const ready = hasContent();
  const goLabel = !walletAddr() ? "Connect wallet" : st.tab === "pick" ? (st.picked ? "Continue with pick ->" : "Pick an inscription to continue") : "Continue -> fund";
  const strip = "background:var(--bg);box-decoration-break:clone;-webkit-box-decoration-break:clone";
  return `
    <div style="position:relative;margin-bottom:12px;height:196px;border:1px solid var(--line);background:var(--panel);overflow:hidden">
      ${step.img ? `<div style="position:absolute;inset:0;image-rendering:pixelated;opacity:.8"><img src="public/img/${step.img}.webp" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>` : ""}
      <div style="position:relative;padding:18px 16px 16px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;justify-content:flex-end;height:196px;box-sizing:border-box">
        <div class="hero" data-tty style="font-size:30px;min-height:1.1em;padding:6px 12px 4px;${strip}">${esc(step.title)}</div>
        <p style="margin:0;max-width:58ch;font:400 15px/1.6 'Jersey 15',monospace;color:var(--ink);padding:4px 12px;${strip}">${esc(step.blurb)}</p>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${tabs}</div>
    <div style="margin-top:12px">${content}</div>
    ${st.tab === "text" || st.tab === "ascii" || (st.staged && st.staged.tab === st.tab) ? `<div class="sm" id="tk_size" style="margin-top:8px">${sizeLine()}</div>` : ""}
    <div id="tk_est">${st.tab === "pick" ? "" : detailsHtml()}</div>
    ${st.error ? `<div class="sm" style="margin-top:10px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <button id="tk_go" class="cta" style="width:100%;margin-top:14px;text-align:center" ${ready || !walletAddr() ? "" : "disabled"}>${goLabel}</button>
    ${st.picked ? `<div class="sm" style="margin-top:8px;text-align:center">Using ${esc(st.picked.kind)} inscription ${esc(shortAddr(st.picked.__txSignature))} · <span class="lnk" id="tk_clearpick">upload a new one instead</span></div>` : ""}`;
}

function progressHtml() {
  return `
    <div class="hero" data-tty style="font-size:22px">${st.phase === "inscribing" ? "Writing to chain. Keep this tab open." : "Launching..."}</div>
    <div style="margin-top:14px;border:1px solid var(--line);aspect-ratio:7/3;overflow:hidden;background:var(--panel);image-rendering:pixelated"><img src="public/img/step_chain.webp" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:14px" class="sm"><span>Progress</span><span id="tk_steplabel">${esc(st.stepLabel || "preparing")}</span></div>
    <div style="margin-top:6px;border:1px solid var(--acc);padding:3px"><div id="tk_bar" style="height:14px;background:var(--acc);width:${st.progress}%"></div></div>
    <div class="sm" style="margin-top:10px">&gt; keep this tab open until every part lands. ${st.chain === "solana" ? "One approval funds a burner key; everything else signs itself, and leftover sweeps back." : "The burner uploads the batches; you sign 3 small clean transactions, and leftover sweeps back."}</div>`;
}

function formHtml() {
  const devBuy = Number(st.devBuy) || 0;
  const fees = [...ch().feeLine, ...(ch().devBuy ? [["dev buy", devBuy + " SOL"]] : []), ["total", ch().totalFor(devBuy)]];
  return `
    <div class="big" data-tty>Step 2 of 2: name it and launch</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <div style="flex:1"><div class="sm">Name</div><input id="tk_name" value="${esc(st.name)}" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
      <div style="flex:0 0 140px"><div class="sm">Symbol</div><input id="tk_sym" value="${esc(st.symbol)}" maxlength="10" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
    </div>
    <div class="sm" style="margin-top:10px">Description</div>
    <textarea id="tk_desc" style="width:100%;box-sizing:border-box;min-height:54px;resize:vertical;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:16px;padding:9px 10px">${esc(st.desc)}</textarea>
    <div style="display:flex;gap:10px;margin-top:10px">
      ${ch().devBuy ? `<div style="flex:0 0 180px"><div class="sm">Initial dev buy (SOL)</div><input id="tk_buy" value="${st.devBuy || ""}" placeholder="0" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>` : ""}
      <div style="flex:1"><div class="sm">X link (optional)</div><input id="tk_x" value="${esc(st.xlink)}" placeholder="https://x.com/..." style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px"></div>
    </div>
    <div style="margin-top:12px;border:1px solid var(--line)" class="sm">
      ${fees.map(([k, v]) => `<div class="kv" style="padding:6px 12px"><span>${k}</span><span style="color:var(--acc)">${v}</span></div>`).join("")}
    </div>
    <div class="sm" style="margin-top:8px">${st.chain === "solana" ? "Fees stream to token holders (holder-rewards coin). If the launch does not go through, the platform fee is not charged." : "Launched on Pons; the coin page links back to your on-chain original. If the launch does not go through, nothing is charged."}</div>
    ${st.error ? `<div class="sm" style="margin-top:10px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <button id="tk_launch" class="cta" style="width:100%;margin-top:12px;text-align:center">Launch on ${ch().venue}</button>
    <div class="sm lnk" id="tk_back" style="margin-top:10px;text-align:center">&larr; back</div>`;
}

function doneHtml() {
  const r = st.result;
  return `
    <div style="border:1px solid var(--line);aspect-ratio:7/3;overflow:hidden;background:var(--panel);image-rendering:pixelated"><img src="public/img/step_launched.webp" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>
    <div style="text-align:center;padding:16px 0 4px">
      <div class="hero" style="font-size:48px" data-tty>Launched.</div>
      <div class="big" style="margin-top:12px">$${esc(st.symbol)} · ${esc(st.name)}</div>
      <div class="sm" style="margin-top:8px">mint: ${esc(r.mint)}<br>a kind=token row was inscribed, so it shows in Markets and on the iqlabs.dev board</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px" class="sm">
      <a class="cta" style="font-size:16px;padding:10px 16px" href="${esc(tradeUrl(ch().market, r.mint))}" target="_blank" rel="noopener">View on ${ch().venue}</a>
      <span class="lnk tk_close" style="align-self:center;border:1px solid var(--line);padding:9px 16px">Open in markets</span>
      <span class="lnk tk_again" style="align-self:center;border:1px solid var(--line);padding:9px 16px">Launch another</span>
    </div>`;
}

// ── wiring + flow ───────────────────────────────────────────────────────────
function wireModalClose(modal, locked) {
  for (const el of modal.querySelectorAll(".tk_close")) el.onclick = () => { st.open = false; modal.innerHTML = ""; };
  const back = modal.querySelector(".tk_backdrop");
  if (back && !locked) back.onclick = (e) => { if (e.target === back) { st.open = false; modal.innerHTML = ""; } };
}

function wireModalEvents(root, modal) {
  for (const b of modal.querySelectorAll(".tk_tab")) b.onclick = () => { st.tab = b.dataset.tab; st.error = null; paintModal(root); };
  const text = modal.querySelector("#tk_text");
  if (text) { text.oninput = () => { st.text = text.value; st.picked = null; refreshEstimate(modal); }; text.focus(); }
  const file = modal.querySelector("#tk_file");
  if (file) file.onchange = () => stageFile(root, file.files[0]);
  const afile = modal.querySelector("#tk_afile");
  if (afile) afile.onchange = () => stageAsciiSource(root, afile.files[0]);
  for (const [id, delta, key] of [["tk_fdec", -1, "font"], ["tk_finc", 1, "font"], ["tk_sdec", -1, "spacing"], ["tk_sinc", 1, "spacing"]]) {
    const b = modal.querySelector("#" + id);
    if (b) b.onclick = () => { st.ascii[key] = Math.max(key === "font" ? 5 : -50, Math.min(50, st.ascii[key] + delta)); renderAscii(root); };
  }
  const c2 = modal.querySelector("#tk_connect2");
  if (c2) c2.onclick = () => st.connectWallet().catch((e) => alert(e.message));
  const clear = modal.querySelector("#tk_clearpick");
  if (clear) clear.onclick = () => { st.picked = null; paintModal(root); };
  const again = modal.querySelector(".tk_again");
  if (again) again.onclick = () => {
    st.phase = "menu"; st.picked = null; st.staged = null; st.text = ""; st.ascii = { dataUrl: null, font: 8, spacing: -2, out: "" };
    st.srcSig = null; st.srcKind = null; st.result = null; st.error = null; st.progress = 0;
    paintModal(root);
  };
  const go = modal.querySelector("#tk_go");
  if (go) go.onclick = () => (walletAddr() ? startInscribe(root) : st.connectWallet().catch((e) => alert(e.message)));
  const launch = modal.querySelector("#tk_launch");
  if (launch) launch.onclick = () => { if (readForm(root, modal)) startLaunch(root); };
  const back = modal.querySelector("#tk_back");
  if (back) back.onclick = () => { readForm(root, modal); st.phase = "menu"; st.error = null; paintModal(root); };
  if (st.tab === "pick" && walletAddr() && st.phase === "menu") loadMine(root);
}

function refreshEstimate(modal) {
  const go = modal.querySelector("#tk_go");
  if (go && walletAddr()) go.toggleAttribute("disabled", !hasContent());
  const box = modal.querySelector("#tk_est");
  if (box) box.innerHTML = st.tab === "pick" ? "" : detailsHtml();
  const size = modal.querySelector("#tk_size");
  if (size) size.textContent = sizeLine();
}

function readForm(root, modal) {
  st.name = ((modal.querySelector("#tk_name") || {}).value || st.name).trim();
  st.symbol = ((modal.querySelector("#tk_sym") || {}).value || st.symbol).toUpperCase().trim();
  const d = modal.querySelector("#tk_desc"); if (d) st.desc = d.value;
  st.devBuy = parseFloat((modal.querySelector("#tk_buy") || {}).value) || 0;
  st.xlink = ((modal.querySelector("#tk_x") || {}).value || "").trim();
  if (!st.name || !st.symbol) { st.error = "name and symbol are required"; paintModal(root); return false; }
  st.error = null;
  return true;
}

const hasContent = () =>
  !!st.picked ||
  (st.tab === "text" ? st.text.trim().length > 0 :
   st.tab === "ascii" ? !!st.ascii.out :
   st.staged && st.staged.tab === st.tab);

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

function stageAsciiSource(root, f) {
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { st.ascii.dataUrl = reader.result; renderAscii(root); };
  reader.readAsDataURL(f);
}

async function renderAscii(root) {
  if (!st.ascii.dataUrl) { paintModal(root); return; }
  try {
    st.ascii.out = await toAscii(st.ascii.dataUrl, st.ascii.font, st.ascii.spacing);
    st.picked = null;
    st.error = null;
  } catch (e) { st.error = "ascii render failed: " + e.message; }
  paintModal(root);
}

async function loadMine(root) {
  const modal = root.querySelector("#tk_modal");
  const el = modal && modal.querySelector("#tk_minelist");
  if (!el) return;
  const side = st.chain === "solana" ? st.sol : st.hood;
  if (!side.mine) {
    try {
      if (st.chain === "solana") side.mine = (await readMine(walletAddr(), 30)).rows.filter((r) => r.kind !== "token");
      else { const { readEvmMine } = await import("../../chain/evm.js"); side.mine = (await readEvmMine(walletAddr(), 30)).rows.filter((r) => r.kind !== "token"); }
    } catch (e) { el.textContent = "could not load your inscriptions: " + e.message; return; }
  }
  const mine = side.mine;
  if (!mine.length) { el.innerHTML = '<div style="text-align:center;padding:16px 0"><div class="big">Nothing saved yet</div><p class="sm">Upload an image first. It is saved on chain, then you come straight back here to launch it.</p></div>'; return; }
  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:236px;overflow-y:auto">' + mine.map((r, i) => {
    const isImg = typeof r.body === "string" && r.body.startsWith("data:image/");
    return `<div class="tk_pickit" data-i="${i}" style="border:1px solid ${st.picked === r ? "var(--acc)" : "var(--line)"};cursor:pointer">
      <div style="aspect-ratio:7/4;overflow:hidden;background:var(--panel);display:grid;place-items:center">${isImg ? `<img src="${r.body}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span class="sm">${esc(r.kind)}</span>`}</div>
      <div style="padding:7px 9px" class="sm"><span class="chip" style="padding:1px 6px">${esc(r.kind)}</span> ${fmtWhen(r.__blockTime)}<div style="margin-top:4px">${esc(shortAddr(r.__txSignature || ""))}</div></div>
    </div>`;
  }).join("") + "</div>";
  for (const it of el.querySelectorAll(".tk_pickit")) it.onclick = () => { st.picked = mine[Number(it.dataset.i)]; st.staged = null; paintModal(root); };
}

function liveProgress(root, pct, label) {
  st.progress = Math.max(st.progress, Math.min(100, pct));
  if (label) st.stepLabel = label;
  const bar = root.querySelector("#tk_bar");
  const lab = root.querySelector("#tk_steplabel");
  if (bar) bar.style.width = st.progress + "%";
  if (lab && label) lab.textContent = label;
  if (!bar) paintModal(root);
}

async function startInscribe(root) {
  if (!hasContent()) return;
  if (st.picked) {
    st.srcSig = st.picked.__txSignature;
    st.srcKind = st.picked.kind;
    st.phase = "form";
    return paintModal(root);
  }
  const kind = st.tab === "text" ? "text" : st.tab === "ascii" ? "ascii" : st.staged.kind;
  const body = st.tab === "text" ? st.text : st.tab === "ascii" ? st.ascii.out : st.staged.body;
  st.phase = "inscribing"; st.progress = 2; st.stepLabel = "preparing"; st.error = null;
  paintModal(root);
  try {
    const who = walletAddr();
    let sig;
    if (st.chain === "solana") {
      liveProgress(root, 4, "deriving your burner key (one signature)");
      const connection = rpcConnect();
      const burner = await ensureSolBurner();
      liveProgress(root, 10, "funding + writing to chain");
      const { inscribeRow } = await import("../../chain/feed.js");
      ({ sig } = await inscribeRow({
        connection, wallet: st.sol.wallet, burner, kind, body, speed: "light",
        onProgress: (p) => liveProgress(root, 10 + Math.round(p * 0.85)),
        onRetry: () => liveProgress(root, st.progress, "paused, retrying (funds are safe in your burner)"),
      }));
      notify(sig, { kind, body, who });
    } else {
      const { inscribeEvm, notifyEvm } = await import("../../chain/evm.js");
      ({ sig } = await inscribeEvm({
        kind, body, who,
        onProgress: (p) => liveProgress(root, 10 + Math.round(p * 0.7)),
        onStatus: (label) => liveProgress(root, st.progress, label),
      }));
      void notifyEvm(sig, { kind, body, who });
    }
    st.srcSig = sig; st.srcKind = kind;
    st.sol.mine = null; st.hood.mine = null;
    st.phase = "form";
  } catch (e) {
    st.phase = "menu";
    st.error = String((e && e.message) || e);
  }
  paintModal(root);
}

async function ensureSolBurner() {
  if (st.sol.burner) return st.sol.burner;
  const { deriveBurner } = await import("../../chain/burner.js");
  st.sol.burner = await deriveBurner((m) => st.sol.wallet.signMessage(m));
  return st.sol.burner;
}

async function startLaunch(root) {
  st.phase = "launching"; st.progress = 5; st.stepLabel = "preparing"; st.error = null;
  paintModal(root);
  try {
    if (st.chain === "solana") await launchSolana(root);
    else await launchHood(root);
    st.phase = "done";
    loadCoins(root).catch(() => {});
  } catch (e) {
    st.phase = "form";
    st.error = String((e && e.message) || e);
  }
  paintModal(root);
}

async function launchSolana(root) {
  const connection = rpcConnect();
  const burner = await ensureSolBurner();
  const who = walletAddr();
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
  // Warm the gateway caches: pump fetches uri + image with short timeouts and a
  // cold reassembly (~25s) would cache as a permanent miss.
  try { fetch(image, { mode: "no-cors" }); } catch (e) {}

  liveProgress(root, 10, "inscribing the coin metadata");
  const { inscribeMeta, inscribeRow } = await import("../../chain/feed.js");
  const { sig: metaSig } = await inscribeMeta({ connection, wallet: st.sol.wallet, burner, json: JSON.stringify(meta) });
  try { fetch(metaUrl(metaSig), { mode: "no-cors" }); } catch (e) {}

  liveProgress(root, 35, "creating the coin on pump.fun");
  const { launchOnPump } = await import("../../chain/launch/pumpfun.js");
  st.result = await launchOnPump({
    connection, wallet: st.sol.wallet, name: st.name, symbol: st.symbol,
    uri: metaUrl(metaSig), devBuySol: st.devBuy,
    onStep: (label) => liveProgress(root, Math.min(90, st.progress + 18), label),
  });

  liveProgress(root, 95, "recording the launch on the feed");
  // The coin exists either way; a registry miss is reported, not fatal.
  try {
    const body = JSON.stringify({ mint: st.result.mint, name: st.name, symbol: st.symbol, src: st.srcSig, meta: metaSig });
    const { sig } = await inscribeRow({ connection, wallet: st.sol.wallet, burner, kind: "token", body, speed: "light" });
    notify(sig, { kind: "token", body, who });
  } catch (e) { console.warn("[launch] registry row failed, the coin is live anyway:", e.message); }
}

async function launchHood(root) {
  const { evmSigner, evmImgUrl, evmRenderUrl, inscribeEvmBoard, notifyEvm } = await import("../../chain/evm.js");
  const { launchOnPons, stripUrls, PONS_DESC_MAX } = await import("../../chain/launch/pons.js");
  const who = walletAddr();
  const logo = st.srcKind === "image" ? evmImgUrl(st.srcSig) : evmRenderUrl(st.srcSig);
  const viewLink = "https://iqlabs.dev/?menu=hoodin&post=" + st.srcSig;
  // Pons hides descriptions over 256 chars or containing any url (measured);
  // the recovery pointer rides socials.website instead.
  const description = (stripUrls(st.desc) + " fully on-chain, reassembles via the IQ SDK").trim().slice(0, PONS_DESC_MAX);
  try { fetch(logo, { mode: "no-cors" }); } catch (e) {}

  liveProgress(root, 20, "launching on pons");
  const out = await launchOnPons({
    signer: evmSigner(), name: st.name, symbol: st.symbol, logo, description,
    socials: { twitter: st.xlink, website: viewLink },
    onStep: (label) => liveProgress(root, Math.min(85, st.progress + 20), label),
  });
  st.result = { mint: out.token, sig: out.txHash };

  liveProgress(root, 92, "recording the launch on the feed");
  try {
    const body = JSON.stringify({ mint: out.token, name: st.name, symbol: st.symbol, src: st.srcSig });
    const { sig } = await inscribeEvmBoard({ kind: "token", body, who });
    void notifyEvm(sig, { kind: "token", body, who });
  } catch (e) { console.warn("[launch] registry row failed, the coin is live anyway:", e.message); }
}
