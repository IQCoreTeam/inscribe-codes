// launch_collection.exe: the 4-step creator wizard (NAME / NETWORK / ITEMS /
// PRICE + DEPLOY) with the three item producers (generate art, hand-craft 1/1s,
// upload a folder). Ends in the deploy engine: one funding signature, staged
// progress, resume on interruption.
import { esc, fmtSol } from "../../ui/fmt.js";
import { call } from "../../services/nft-backend.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { fileToBitmap, bitmapToImageData, compositeImageData, compositeDataUrl } from "../../ui/image.js";
import { session, addr, connectWallet, ensureBurner } from "./session.js";

const st = {
  step: 1, producer: "generate",
  name: "", symbol: "", slug: "", slugState: null, description: "",
  logoBitmap: null, bannerBitmap: null,
  layers: [], supply: 100, generated: null, // generated: {items, previews}
  handItems: [],
  folderItems: null, folderReport: "",
  priceSol: "0.01", depositSol: "0", royaltyPct: "5", sequential: false,
  deploying: false, error: null, result: null, progress: 0, label: "",
};

export function open(root) {
  st.step = 1; st.error = null; st.result = null; st.deploying = false;
  paint(root);
}

const STEPS = ["NAME", "NETWORK", "ITEMS", "MINT TERMS"];

function items() {
  if (st.producer === "generate") return st.generated && st.generated.items;
  if (st.producer === "handcraft") return st.handItems.length ? st.handItems.map((it) => ({ name: it.name, template: { attributes: it.traits }, imageData: () => bitmapToImageData(it.bitmap) })) : null;
  return st.folderItems;
}

function paint(root) {
  const modal = root.querySelector("#nf_modal");
  if (!modal) return;
  const body =
    st.result ? doneHtml() :
    st.deploying ? progressHtml() :
    st.step === 1 ? nameHtml() :
    st.step === 2 ? networkHtml() :
    st.step === 3 ? itemsHtml() :
    termsHtml();
  modal.innerHTML = `
<div class="ns_backdrop" style="position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.9);display:flex;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto">
  <div class="win" style="width:860px;max-width:100%;background:var(--bg)">
    <div class="wh"><span>launch_collection.exe</span>
      <span class="sm">${STEPS.map((s, i) => `<span style="color:${i + 1 === st.step && !st.deploying && !st.result ? "var(--acc)" : "var(--mut)"}">${i + 1}·${s}</span>`).join(" ")}</span>
      <span class="lnk ns_close" style="padding:0 8px">x</span></div>
    <div style="padding:20px 22px">${body}</div>
  </div>
</div>`;
  for (const x of modal.querySelectorAll(".ns_close")) x.onclick = () => { if (!st.deploying) modal.innerHTML = ""; };
  wire(root, modal);
}

const input = (id, value, placeholder = "", extra = "") =>
  `<input id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra} style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px">`;

// ── step 1: NAME ────────────────────────────────────────────────────────────
function nameHtml() {
  const slugMsg = st.slugState === "free" ? '<span style="color:var(--acc)">available</span>'
    : st.slugState === "taken" ? '<span style="color:var(--bad)">already taken</span>'
    : st.slugState === "short" ? '<span style="color:var(--mut)">3+ chars, a-z 0-9 -</span>' : "";
  return `
    <div class="big" data-tty>Step 1: name the collection</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <div style="flex:1"><div class="sm">Collection name</div>${input("ns_name", st.name, "Pixel Monks")}</div>
      <div style="flex:0 0 140px"><div class="sm">Symbol</div>${input("ns_sym", st.symbol, "MONK", 'maxlength="10"')}</div>
    </div>
    <div style="margin-top:10px"><div class="sm">Collection URL (set once)</div>
      <div style="display:flex;align-items:center;gap:6px"><span class="sm" style="white-space:nowrap">inscribe.codes/?view=nft&c=</span>${input("ns_slug", st.slug, "pixel-monks")}</div>
      <div class="sm" id="ns_slugmsg" style="margin-top:4px">${slugMsg}</div></div>
    <div style="margin-top:10px"><div class="sm">Description</div>
      <textarea id="ns_desc" style="width:100%;box-sizing:border-box;min-height:54px;resize:vertical;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:16px;padding:9px 10px">${esc(st.description)}</textarea></div>
    <div style="display:flex;gap:14px;margin-top:10px" class="sm">
      <label style="flex:1;border:1px dashed var(--acc);padding:12px;text-align:center;cursor:pointer">${st.logoBitmap ? "logo set ✓ (click to replace)" : "Logo (optional, square)"}<input id="ns_logo" type="file" accept="image/*" style="display:none"></label>
      <label style="flex:1;border:1px dashed var(--acc);padding:12px;text-align:center;cursor:pointer">${st.bannerBitmap ? "banner set ✓ (click to replace)" : "Banner (optional, 3:1)"}<input id="ns_banner" type="file" accept="image/*" style="display:none"></label>
    </div>
    <div class="sm" style="margin-top:6px;color:var(--mut)">Logo and banner are inscribed on-chain at deploy, like everything else.</div>
    ${st.error ? `<div class="sm" style="margin-top:8px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <button class="cta ns_next" style="width:100%;margin-top:14px;text-align:center">CONTINUE</button>`;
}

// ── step 2: NETWORK ─────────────────────────────────────────────────────────
function networkHtml() {
  return `
    <div class="big" data-tty>Step 2: pick the chain</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px">
      <button class="ns_net" style="border:1px solid var(--acc);background:var(--panel2);padding:22px;text-align:center;cursor:pointer">
        <div class="hero" style="font-size:22px;color:var(--acc)">SOLANA</div><div class="sm" style="margin-top:4px">live</div></button>
      <div style="border:1px solid var(--line);padding:22px;text-align:center;opacity:.45">
        <div class="hero" style="font-size:22px">ROBINHOOD</div><div class="sm" style="margin-top:4px">coming soon</div></div>
      <div style="border:1px solid var(--line);padding:22px;text-align:center;opacity:.45">
        <div class="hero" style="font-size:22px">MONAD</div><div class="sm" style="margin-top:4px">coming soon</div></div>
    </div>
    <div class="sm" style="margin-top:12px">Every item's image and metadata become Solana inscriptions; the NFT (Metaplex Core) just points at them.</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="chip ns_back">&larr; BACK</button><button class="cta ns_next" style="flex:1;text-align:center">CONTINUE ON SOLANA</button></div>`;
}

// ── step 3: ITEMS (three producers) ────────────────────────────────────────
function itemsHtml() {
  const tabs = [["generate", "GENERATE ART"], ["handcraft", "HAND-CRAFT 1/1s"], ["folder", "UPLOAD A FOLDER"]]
    .map(([id, label]) => `<button class="chip ns_prod ${st.producer === id ? "live" : ""}" data-p="${id}" style="padding:8px 12px;font-size:12px">${label}</button>`).join("");
  const got = items();
  return `
    <div class="big" data-tty>Step 3: the items</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${tabs}</div>
    <div style="margin-top:12px">${st.producer === "generate" ? generateHtml() : st.producer === "handcraft" ? handcraftHtml() : folderHtml()}</div>
    ${st.error ? `<div class="sm" style="margin-top:8px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button class="chip ns_back">&larr; BACK</button>
      <button class="cta ns_next" style="flex:1;text-align:center" ${got && got.length ? "" : "disabled"}>${got && got.length ? "CONTINUE WITH " + got.length + " ITEMS" : "ADD ITEMS FIRST"}</button></div>`;
}

function generateHtml() {
  const combos = st.layers.length ? st.layers.reduce((n, l) => n * Math.max(1, l.traits.length), 1) : 0;
  const over = st.layers.length && st.supply > combos;
  return `
    <div class="sm" style="border:1px solid var(--line);padding:10px 12px;line-height:1.7">A collection is built from stacked layers (background, body, eyes, ...). Give each layer a few trait images; every item is a unique random combination. Trait value = the file name. Shrink big art at <a href="https://squoosh.app" target="_blank" rel="noopener">squoosh.app</a> first.</div>
    <div id="ns_layers" style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
      ${st.layers.map((l, i) => `
        <div style="border:1px solid var(--line);padding:8px 10px" class="sm">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="color:var(--acc)">${String(i + 1).padStart(2, "0")}</span>
            <span class="big" style="font-size:16px;flex:1">${esc(l.name)}</span>
            <span>${l.traits.length} trait${l.traits.length === 1 ? "" : "s"}</span>
            <button class="lnk ns_lup" data-i="${i}">&uarr;</button><button class="lnk ns_ldn" data-i="${i}">&darr;</button>
            <label class="lnk" style="cursor:pointer">+ images<input type="file" class="ns_ltraits" data-i="${i}" accept="image/*" multiple style="display:none"></label>
            <button class="lnk ns_lrm" data-i="${i}" style="color:var(--bad)">remove</button>
          </div>
          ${l.traits.length ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${l.traits.map((t) => `<span class="chip" style="font-size:10px">${esc(t.name)}</span>`).join("")}</div>` : ""}
        </div>`).join("")}
    </div>
    <div style="display:flex;gap:10px;margin-top:10px;align-items:center" class="sm">
      <input id="ns_lname" placeholder="layer name (background, body, ...)" style="flex:1;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:16px;padding:8px 10px">
      <button class="chip" id="ns_ladd">+ ADD LAYER</button>
    </div>
    <div style="display:flex;gap:14px;margin-top:12px;align-items:center;flex-wrap:wrap" class="sm">
      <span>Supply <input id="ns_supply" value="${st.supply}" style="width:80px;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:16px;padding:6px 8px"></span>
      <span style="color:${over ? "var(--cta)" : "var(--mut)"}">${combos ? combos.toLocaleString() + " unique combinations possible" + (over ? " · supply exceeds it" : "") : ""}</span>
      <button class="cta" id="ns_gen" style="font-size:14px;padding:8px 14px" ${st.layers.length && st.layers.every((l) => l.traits.length) ? "" : "disabled"}>GENERATE ${st.supply}</button>
    </div>
    ${st.generated ? `<div class="sm" style="margin-top:10px">${st.generated.items.length} items generated (unique by trait DNA). First ${st.generated.previews.length}:</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-top:6px">${st.generated.previews.map((u) => `<img src="${u}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--line)">`).join("")}</div>` : ""}`;
}

function handcraftHtml() {
  return `
    <div class="sm" style="border:1px solid var(--line);padding:10px 12px;line-height:1.7">Each card is one 1/1: an image, a name, optional traits (one per line as <span style="color:var(--acc)">type: value</span>).</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:10px">
      ${st.handItems.map((it, i) => `
        <div style="border:1px solid var(--line);padding:8px" class="sm">
          <img src="${it.url}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--line)">
          <input class="ns_hname" data-i="${i}" value="${esc(it.name)}" placeholder="name" style="width:100%;box-sizing:border-box;margin-top:6px;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:14px;padding:6px 8px">
          <textarea class="ns_htraits" data-i="${i}" placeholder="hat: crown&#10;mood: gm" style="width:100%;box-sizing:border-box;margin-top:6px;min-height:44px;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:12px;padding:6px 8px">${esc(it.traitsText || "")}</textarea>
          <button class="lnk ns_hrm" data-i="${i}" style="color:var(--bad);margin-top:4px">remove</button>
        </div>`).join("")}
      <label style="border:1px dashed var(--acc);display:grid;place-items:center;min-height:140px;cursor:pointer" class="sm">+ ADD ITEMS<input id="ns_hadd" type="file" accept="image/*" multiple style="display:none"></label>
    </div>`;
}

function folderHtml() {
  return `
    <div class="sm" style="border:1px solid var(--line);padding:10px 12px;line-height:1.7">
      Expected folder: <span style="color:var(--acc)">0.png, 1.png, ...</span> (or 1-based) with optional matching <span style="color:var(--acc)">0.json</span> files ({ name, description, attributes } OpenSea shape; missing json = autogenerated name). Any asset urls inside are rewritten to on-chain urls at deploy.</div>
    <label style="display:block;border:1px dashed var(--acc);padding:26px;text-align:center;cursor:pointer;margin-top:10px" class="sm">
      ${st.folderItems ? st.folderItems.length + " items parsed ✓ (click to re-pick)" : "Pick the folder"}
      <input id="ns_folder" type="file" webkitdirectory multiple style="display:none">
    </label>
    ${st.folderReport ? `<pre class="sm" style="margin-top:10px;border:1px solid var(--line);padding:10px;white-space:pre-wrap">${esc(st.folderReport)}</pre>` : ""}`;
}

// ── step 4: terms + deploy ──────────────────────────────────────────────────
function termsHtml() {
  const n = (items() || []).length;
  const feeLamports = 10_000_000 + n * 300_000; // deployFeeBase + per item (backend quotes the exact value at stage)
  return `
    <div class="big" data-tty>Step 4: mint terms, then deploy</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <div style="flex:1"><div class="sm">Mint price (SOL)</div>${input("ns_price", st.priceSol)}</div>
      <div style="flex:1"><div class="sm">Deposit (SOL, anti-snipe; counts toward price)</div>${input("ns_deposit", st.depositSol)}</div>
      <div style="flex:1"><div class="sm">Royalties (%)</div>${input("ns_royalty", st.royaltyPct)}</div>
    </div>
    <label class="sm" style="display:flex;gap:8px;margin-top:10px;cursor:pointer"><input id="ns_seq" type="checkbox" ${st.sequential ? "checked" : ""}> sequential assignment (default: random with a committed shuffle)</label>
    <div style="margin-top:12px;border:1px solid var(--line)" class="sm">
      <div class="kv" style="padding:6px 12px"><span>items</span><span>${n}</span></div>
      <div class="kv" style="padding:6px 12px"><span>deploy fee (covers Arweave + platform)</span><span>~${fmtSol(feeLamports)}</span></div>
      <div class="kv" style="padding:6px 12px"><span>your signatures</span><span style="color:var(--acc)">1 funding transfer (leftover sweeps back)</span></div>
      <div class="kv" style="padding:6px 12px;border-bottom:none"><span>buyers pay</span><span>price + their own inscription (~0.0135 SOL)</span></div>
    </div>
    <div class="sm" style="margin-top:8px">You stay the collection authority and the treasury; the platform never holds your keys or your money.</div>
    ${st.error ? `<div class="sm" style="margin-top:8px;color:var(--bad)">${esc(st.error)}</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button class="chip ns_back">&larr; BACK</button>
      <button class="cta" id="ns_deploy" style="flex:1;text-align:center">${addr() ? "DEPLOY (1 signature)" : "CONNECT WALLET"}</button></div>`;
}

function progressHtml() {
  return `
    <div class="hero" style="font-size:24px">Deploying. Keep this tab open...</div>
    <div class="sm" style="margin-top:10px" id="ns_label">${esc(st.label || "preparing")}</div>
    <div style="margin-top:14px;border:1px solid var(--acc);padding:3px"><div id="ns_bar" style="height:14px;background:var(--acc);width:${st.progress}%"></div></div>
    <div class="sm" style="margin-top:10px">Every step is checkpointed: if this is interrupted, deploy again with the same handle and it resumes without paying twice.</div>`;
}

function doneHtml() {
  const r = st.result;
  return `
    <div style="text-align:center;padding:10px 0">
      <div class="hero" style="font-size:42px" data-tty>LIVE.</div>
      <div class="big" style="margin-top:8px">${esc(st.name)} · ${r.itemCount} items</div>
      <div class="sm" style="margin-top:8px">collection ${esc(r.collection)}<br>your wallet holds the authority and receives the mint price.</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:16px" class="sm">
        <a class="cta" style="font-size:16px;padding:8px 14px" href="?view=nft&c=${esc(r.slug)}">OPEN THE COLLECTION PAGE</a>
        <a href="${esc(explorerTx(r.deploySig))}" target="_blank" rel="noopener" style="align-self:center">deploy tx</a>
      </div>
      <div class="sm" style="margin-top:12px">Share: inscribe.codes/?view=nft&c=${esc(r.slug)}</div>
    </div>`;
}

// ── wiring ──────────────────────────────────────────────────────────────────
function wire(root, modal) {
  const on = (sel, fn) => { const el = modal.querySelector(sel); if (el) fn(el); };
  for (const b of modal.querySelectorAll(".ns_back")) b.onclick = () => { st.step--; st.error = null; paint(root); };
  for (const b of modal.querySelectorAll(".ns_prod")) b.onclick = () => { st.producer = b.dataset.p; st.error = null; paint(root); };
  on(".ns_net", (el) => { el.onclick = () => { st.step = 3; paint(root); }; });

  // step 1
  on("#ns_name", (el) => { el.oninput = () => { st.name = el.value; }; });
  on("#ns_sym", (el) => { el.oninput = () => { st.symbol = el.value.toUpperCase(); }; });
  on("#ns_desc", (el) => { el.oninput = () => { st.description = el.value; }; });
  on("#ns_slug", (el) => {
    el.oninput = () => {
      st.slug = el.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (el.value !== st.slug) el.value = st.slug;
      checkSlug(modal);
    };
  });
  on("#ns_logo", (el) => { el.onchange = async () => { if (el.files[0]) { st.logoBitmap = await fileToBitmap(el.files[0]); paint(root); } }; });
  on("#ns_banner", (el) => { el.onchange = async () => { if (el.files[0]) { st.bannerBitmap = await fileToBitmap(el.files[0]); paint(root); } }; });

  for (const b of modal.querySelectorAll(".ns_next")) b.onclick = () => {
    if (st.step === 1) {
      if (!st.name.trim() || !st.symbol.trim() || st.slug.length < 3) { st.error = "name, symbol and a 3+ char handle are required"; return paint(root); }
      if (st.slugState === "taken") { st.error = 'the handle "' + st.slug + '" is taken'; return paint(root); }
    }
    st.step++; st.error = null; paint(root);
  };

  // step 3: generate
  on("#ns_ladd", (el) => {
    el.onclick = () => {
      const name = (modal.querySelector("#ns_lname").value || "").trim();
      if (!name) return;
      st.layers.push({ name, traits: [] });
      st.generated = null; paint(root);
    };
  });
  for (const inp of modal.querySelectorAll(".ns_ltraits")) inp.onchange = async () => {
    const l = st.layers[Number(inp.dataset.i)];
    for (const f of inp.files) l.traits.push({ name: f.name.replace(/\.[^.]+$/, ""), bitmap: await fileToBitmap(f) });
    st.generated = null; paint(root);
  };
  for (const b of modal.querySelectorAll(".ns_lrm")) b.onclick = () => { st.layers.splice(Number(b.dataset.i), 1); st.generated = null; paint(root); };
  for (const b of modal.querySelectorAll(".ns_lup")) b.onclick = () => { const i = Number(b.dataset.i); if (i > 0) { st.layers.splice(i - 1, 0, st.layers.splice(i, 1)[0]); st.generated = null; paint(root); } };
  for (const b of modal.querySelectorAll(".ns_ldn")) b.onclick = () => { const i = Number(b.dataset.i); if (i < st.layers.length - 1) { st.layers.splice(i + 1, 0, st.layers.splice(i, 1)[0]); st.generated = null; paint(root); } };
  on("#ns_supply", (el) => { el.oninput = () => { st.supply = Math.max(1, Math.min(10000, parseInt(el.value) || 0)); }; });
  on("#ns_gen", (el) => { el.onclick = () => { generate(); paint(root); }; });

  // step 3: handcraft
  on("#ns_hadd", (el) => {
    el.onchange = async () => {
      for (const f of el.files) {
        const bitmap = await fileToBitmap(f);
        st.handItems.push({ bitmap, url: URL.createObjectURL(f), name: f.name.replace(/\.[^.]+$/, ""), traitsText: "", traits: [] });
      }
      paint(root);
    };
  });
  for (const el of modal.querySelectorAll(".ns_hname")) el.oninput = () => { st.handItems[Number(el.dataset.i)].name = el.value; };
  for (const el of modal.querySelectorAll(".ns_htraits")) el.oninput = () => {
    const it = st.handItems[Number(el.dataset.i)];
    it.traitsText = el.value;
    it.traits = el.value.split("\n").map((line) => line.split(":")).filter((p) => p.length >= 2 && p[0].trim())
      .map((p) => ({ trait_type: p[0].trim(), value: p.slice(1).join(":").trim() }));
  };
  for (const b of modal.querySelectorAll(".ns_hrm")) b.onclick = () => { st.handItems.splice(Number(b.dataset.i), 1); paint(root); };

  // step 3: folder
  on("#ns_folder", (el) => { el.onchange = () => parseFolder(root, el.files); });

  // step 4
  on("#ns_price", (el) => { el.oninput = () => { st.priceSol = el.value; }; });
  on("#ns_deposit", (el) => { el.oninput = () => { st.depositSol = el.value; }; });
  on("#ns_royalty", (el) => { el.oninput = () => { st.royaltyPct = el.value; }; });
  on("#ns_seq", (el) => { el.onchange = () => { st.sequential = el.checked; }; });
  on("#ns_deploy", (el) => { el.onclick = () => runDeploy(root); });
}

let slugTimer = null;
function checkSlug(modal) {
  const msg = modal.querySelector("#ns_slugmsg");
  clearTimeout(slugTimer);
  if (st.slug.length < 3) { st.slugState = "short"; if (msg) msg.innerHTML = '<span style="color:var(--mut)">3+ chars, a-z 0-9 -</span>'; return; }
  const checking = st.slug;
  slugTimer = setTimeout(async () => {
    const r = await call("/c/" + checking).catch(() => null);
    if (st.slug !== checking) return;
    st.slugState = r && r.status === 200 ? "taken" : "free";
    if (msg) msg.innerHTML = st.slugState === "taken" ? '<span style="color:var(--bad)">already taken</span>' : '<span style="color:var(--acc)">available &rarr; inscribe.codes/?view=nft&c=' + esc(checking) + "</span>";
  }, 350);
}

function generate() {
  const layers = st.layers;
  const combos = layers.reduce((n, l) => n * Math.max(1, l.traits.length), 1);
  const supply = Math.min(st.supply, combos);
  const seen = new Set();
  const dnas = [];
  for (let guard = 0; dnas.length < supply && guard < supply * 50; guard++) {
    const picks = layers.map((l) => Math.floor(Math.random() * l.traits.length));
    const dna = picks.join(",");
    if (seen.has(dna)) continue;
    seen.add(dna);
    dnas.push(picks);
  }
  // snapshot the layer set so later edits cannot shift what deploy composites
  const snapshot = layers.map((l) => ({ name: l.name, traits: l.traits.slice() }));
  st.generated = {
    items: dnas.map((picks, i) => ({
      name: st.name + " #" + (i + 1),
      template: { attributes: snapshot.map((l, li) => ({ trait_type: l.name, value: l.traits[picks[li]] ? l.traits[picks[li]].name : "" })) },
      imageData: () => compositeImageData(snapshot, picks), // lazy: one composite at a time at deploy
    })),
    previews: dnas.slice(0, 18).map((picks) => compositeDataUrl(snapshot, picks, 96)),
  };
  if (st.supply > combos) st.error = "only " + combos + " unique combinations exist; generated " + dnas.length;
  else st.error = null;
}

async function parseFolder(root, files) {
  const imgs = new Map(), jsons = new Map();
  for (const f of files) {
    const m = f.name.match(/^(\d+)\.(png|jpe?g|webp|gif|json)$/i);
    if (!m) continue;
    const n = parseInt(m[1]);
    if (/json/i.test(m[2])) jsons.set(n, f); else imgs.set(n, f);
  }
  if (!imgs.size) { st.folderItems = null; st.folderReport = "no N.png / N.jpg files found at the folder root"; return paint(root); }
  const keys = [...imgs.keys()].sort((a, b) => a - b);
  const base = keys[0]; // 0- or 1-based, normalized to indices 1..N
  const gaps = keys.filter((k, i) => k !== base + i);
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const bitmap = await fileToBitmap(imgs.get(k));
    let meta = {};
    if (jsons.has(k)) {
      try { meta = JSON.parse(await jsons.get(k).text()); }
      catch (e) { st.folderReport = k + ".json is not valid JSON"; st.folderItems = null; return paint(root); }
    }
    out.push({
      index: i + 1,
      name: meta.name || st.name + " #" + (i + 1),
      template: { ...(meta.description ? { description: meta.description } : {}), attributes: Array.isArray(meta.attributes) ? meta.attributes : [] },
      imageData: () => bitmapToImageData(bitmap),
    });
  }
  st.folderItems = out;
  st.folderReport = out.length + " images (" + (base === 0 ? "0" : "1") + "-based), " + jsons.size + " json files"
    + (gaps.length ? "\nwarning: numbering gaps at " + gaps.slice(0, 10).join(", ") + " (items were renumbered 1.." + out.length + ")" : "")
    + "\nimage fields inside json are ignored; the on-chain inscription url replaces them at deploy.";
  paint(root);
}

const STAGE_LINES = {
  compress: (x) => [2 + Math.round((x.done / x.total) * 38), "compressing " + x.done + " / " + x.total],
  stage: (x) => [4 + Math.round((x.done / x.total) * 38), "uploading " + x.done + " / " + x.total + " to Arweave"],
  funding: () => [46, "funding the burner (approve one transfer)"],
  manifest: () => [52, "inscribing the manifest on Solana"],
  logo: () => [66, "inscribing the logo"],
  banner: () => [70, "inscribing the banner"],
  collection: () => [74, "inscribing collection.json"],
  deploy: () => [85, "landing the deploy transaction"],
  finalize: () => [95, "finalizing"],
};

async function runDeploy(root) {
  if (st.deploying) return;
  if (!addr()) { try { await connectWallet(); } catch (e) { st.error = e.message; } return paint(root); }
  const its = items();
  if (!its || !its.length) { st.error = "no items"; st.step = 3; return paint(root); }
  st.deploying = true; st.error = null; st.progress = 1; st.label = "starting";
  paint(root);
  const live = (pct, label) => {
    st.progress = Math.max(st.progress, pct); st.label = label;
    const bar = root.querySelector("#ns_bar"), lab = root.querySelector("#ns_label");
    if (bar) bar.style.width = st.progress + "%";
    if (lab) lab.textContent = label;
  };
  try {
    const connection = rpcConnect();
    const burner = await ensureBurner();
    const spec = {
      slug: st.slug, name: st.name.trim(), symbol: st.symbol.trim(), description: st.description.trim(),
      price: Math.round(parseFloat(st.priceSol || "0") * 1e9) || 0,
      deposit: Math.round(parseFloat(st.depositSol || "0") * 1e9) || 0,
      royaltyBps: Math.round(parseFloat(st.royaltyPct || "0") * 100) || 0,
      sequential: st.sequential,
      logo: st.logoBitmap ? () => bitmapToImageData(st.logoBitmap) : null,
      banner: st.bannerBitmap ? () => bitmapToImageData(st.bannerBitmap, 1024) : null,
    };
    const { deploy } = await import("../../chain/nft-deploy.js");
    st.result = await deploy({
      connection, wallet: session.wallet, burner, spec, items: its,
      onStage: (s, x) => { const line = STAGE_LINES[s]; if (line) live(...line(x || {})); },
    });
  } catch (e) {
    st.error = String((e && e.message) || e);
    st.deploying = false;
    st.step = 4;
    paint(root);
    return;
  }
  st.deploying = false;
  paint(root);
}
