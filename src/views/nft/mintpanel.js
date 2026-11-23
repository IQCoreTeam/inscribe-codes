// The mint panel (design/NFT Launchpad Flow v6): price, progress, details and
// the mint action for one collection. It is the right column of the collection
// page and the market's side window while a collection is open. The mint runs
// inline: approve -> confirming (tty bar + log) -> Minted, which replaces the
// whole panel until "Mint another".
import { esc, fmtSol, shortAddr } from "../../ui/fmt.js";
import * as nft from "../../services/nft-backend.js";
import { tensorItem } from "../../services/markets.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { statusOf, chainOf, priceOf, amountOf, tcls, segsHtml, usdSlot, fillUsd } from "./launchpad.js";
import { session, addr, connectWallet, ensureBurner } from "./session.js";

const MINT_OVERHEAD = "~0.0135 SOL"; // image + metadata inscription + asset rent, measured on mainnet
const BAR_W = 28;
const bar = (p) => { const n = Math.max(0, Math.min(BAR_W, Math.round((BAR_W * p) / 100))); return "[" + "█".repeat(n) + "░".repeat(BAR_W - n) + "] " + Math.round(p) + "%"; };
const when = (unix) => (unix ? new Date(unix * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const CANNOT = { Upcoming: "Not started yet", "Sold out": "Sold out · buy one in Market", Ended: "Mint ended" };
const STAGE_PCT = { funding: 5, deposit: 15, reserve: 20, image: 25, metadata: 80, register: 90, confirming: 95 };
const STAGE_LINE = {
  deposit: () => "deposit paid",
  reserve: () => "reserving your item",
  image: (x) => "item " + (x && x.index != null ? "#" + x.index : "") + ": inscribing the image",
  metadata: () => "inscribing the details",
  register: () => "registering the NFT (co-sign)",
  confirming: () => "waiting for confirmation",
};

// onMinted(collection) fires with the refreshed collection after a mint lands.
// Returns { repaint } for the page to call when the wallet changes.
export function mountMintPanel(el, col, { onMinted } = {}) {
  // short: { need, have } raw token units, set when a mint stopped because the
  // wallet does not hold enough of the collection's token.
  const st = { col, mint: "idle", pct: 0, log: [], result: null, error: null, short: null, busy: false };
  const q = (sel) => el.querySelector(sel);

  function topHtml() {
    const c = st.col, ch = chainOf(c), status = statusOf(c), cur = nft.curOf(c);
    const [num, unit] = c.priceLamports ? [cur ? priceOf(c).split(" ")[0] : String(+(c.priceLamports / 1e9).toFixed(4)), cur ? cur.symbol : ch.unit] : ["FREE", ""];
    return `
      <div class="lab" style="letter-spacing:.2em;opacity:.7">Mint</div>
      <div class="nf-pricebox">
        <div class="nf-price"><span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span>
          <span class="nf-pricenum ${tcls(c)}">${esc(num)}</span>${unit ? `<span class="nf-priceunit ${tcls(c)}">${esc(unit)}</span>` : ""}</div>
        ${c.priceLamports ? `<div class="cm" style="margin-top:10px">${usdSlot(c.priceLamports, c)}</div>` : ""}
        ${cur ? `<div class="cm">${esc(cur.symbol)}${cur.issuer ? " · issued by " + esc(cur.issuer) : ""}</div>` : ""}
        <div class="cm">+ ${MINT_OVERHEAD} to put your item on chain. Nothing hidden.</div>
      </div>
      <div>
        <div class="cc-segs" style="height:14px;margin:0">${segsHtml(c.minted, c.maxSupply)}</div>
        <div class="nf-mintedline"><span style="color:var(--acc)">${c.minted.toLocaleString("en-US")} / ${c.maxSupply.toLocaleString("en-US")}</span><span>Minted</span></div>
      </div>
      <details class="nf-details"><summary>details ▸</summary><div>
        <div class="kv"><span>phase</span><span class="${status === "LIVE" ? "mint" : status === "Upcoming" ? "amber" : ""}">${c.allowlistOnly ? "ALLOWLIST" : "PUBLIC"} · ${status}</span></div>
        <div class="kv"><span>per wallet</span><span>${c.maxPerWallet ? c.maxPerWallet + " per wallet" : "no limit"}</span></div>
        <div class="kv"><span>starts / ends</span><span>${when(c.startAt) || "open"} → ${when(c.endAt) || "open"}</span></div>
        <div class="kv"><span>order</span><span>${c.sequential ? "sequential" : "random"}</span></div>
        ${cur ? `<div class="kv"><span>pay with</span><span>${esc(cur.symbol)} from your wallet, plus 5% platform fee</span></div>` : ""}
        ${c.depositLamports ? `<div class="kv"><span>deposit</span><span>${fmtSol(c.depositLamports)} at reservation, counts toward the price</span></div>` : ""}
        <div class="kv"><span>you</span><span>${addr() ? "connected · " + esc(shortAddr(addr())) : "not connected"}</span></div>
      </div></details>
      <div id="mp_act"></div>`;
  }

  async function paint() {
    if (!el.isConnected) return;
    const c = st.col, cur = nft.curOf(c);
    if (st.mint === "done") {
      const r = st.result;
      el.innerHTML = `
        <div style="text-align:center;padding:6px 0 2px"><div data-tty class="nf-minted">Minted.</div><div class="cm" style="margin-top:10px">${esc(r.name || c.name + " #" + r.index)} · owner ${esc(shortAddr(addr()))}</div></div>
        <div>
          <div class="kv"><span>image on chain</span><span class="mint">${esc(shortAddr(r.C))}</span></div>
          <div class="kv"><span>details on chain</span><span class="mint">${esc(shortAddr(r.M))}</span></div>
          <div class="kv"><span>link</span><span>gateway.iqlabs.dev/token-meta/${esc(shortAddr(r.M))}</span></div>
        </div>
        <div class="nf-btnrow lab">
          <a class="btng" href="?view=nft&asset=${esc(r.asset)}">View NFT →</a>
          <a class="btn2" href="${esc(tensorItem(r.asset))}" target="_blank" rel="noopener">Tensor</a>
          <a class="btn2" href="${esc(explorerTx(r.C))}" target="_blank" rel="noopener">Solscan</a>
          <button class="btn2" id="mp_again">Mint another</button>
        </div>`;
      q("#mp_again").onclick = () => { st.mint = "idle"; st.result = null; paint(); };
      return;
    }
    el.innerHTML = topHtml();
    fillUsd(el);
    const act = q("#mp_act");
    if (st.mint === "approve") {
      act.innerHTML = '<div class="ttyspin nf-approve">Approve in your wallet…</div><div class="cm">One transfer funds the whole mint; whatever is left comes back to you.</div>';
      return;
    }
    if (st.mint === "confirm") {
      act.innerHTML = `<div class="ttybar" id="mp_bar">${bar(st.pct)}</div><div class="ttyspin cm" style="margin-top:6px" id="mp_phase">${esc(st.log[st.log.length - 1] || "working…")}</div>
        <div class="nf-log" id="mp_log">${st.log.map((l) => "<div>&gt; " + esc(l) + "</div>").join("")}</div>
        <div class="cm">Keep this tab open. If it stops, come back and press Resume: every step is checkpointed, nothing is paid twice.</div>`;
      return;
    }
    // idle (or paused with an error). A mint that cannot happen says so before
    // asking for a wallet.
    const cannot = CANNOT[statusOf(c)];
    const { pendingMint } = await import("../../chain/nft.js");
    const resume = pendingMint(c.slug);
    act.innerHTML = `
      ${st.error ? `<div class="cm" style="color:var(--bad)">${esc(st.error)}</div>` : ""}
      ${cannot ? `<div class="btn2 nf-cannot">${cannot}</div>`
        : !addr() ? '<div class="nf-connectmint" id="mp_connect">Connect wallet to mint</div>'
        : st.short ? `<div class="btn2 nf-cannot">Mint one · ${esc(priceOf(c))}</div><div class="cm" style="color:var(--cta)">Not enough ${esc(cur.symbol)} in your wallet.</div><div class="cm nf-disclose" style="border:0;padding:0">You need ${esc(amountOf(st.short.need, c))}. You have ${esc(amountOf(st.short.have, c))}.</div><div class="btn nf-mintbtn" id="mp_swap">Get ${esc(cur.symbol)} with SOL</div>`
        : `<button class="btn nf-mintbtn" id="mp_mint">${resume || st.error ? "Resume mint" : "Mint one · " + esc(priceOf(c))}</button>`}
      ${resume && !st.error ? '<div class="cm" style="color:#8dffa0">An unfinished mint was found; only the missing steps are redone.</div>' : ""}
      <div class="cm">${cur && !cannot ? `<div class="nf-need" id="mp_need">Need ${esc(cur.symbol)}? Get it with SOL →</div>` : ""}<div>One signature. You pay${cur ? " in " + esc(cur.symbol) : ""}, you own it.</div><div>The NFT points at its image and details stored on chain.</div></div>
      ${cur ? '<div class="cm nf-disclose">Not issued or custodied by inscribe.codes. Eligibility follows the issuer\'s terms.</div>' : ""}`;
    const connect = q("#mp_connect");
    if (connect) connect.onclick = () => document.querySelector("#nav_wallet .navconnect")?.click();
    const mintBtn = q("#mp_mint");
    if (mintBtn) mintBtn.onclick = run;
    for (const id of ["#mp_need", "#mp_swap"]) { const n = q(id); if (n) n.onclick = getToken; }
  }

  // The swap window, prefilled with what one mint still needs: the price plus
  // the 5% platform fee, less what the wallet already holds. A completed swap
  // clears the shortfall so the mint button is back.
  async function getToken() {
    const cur = nft.curOf(st.col), due = st.col.priceLamports + Math.floor(st.col.priceLamports * 0.05);
    (await import("./swap.js")).openSwap({
      cur, want: st.short ? st.short.need - st.short.have : due, purpose: "mint",
      onClose: (got) => { if (got) { st.short = null; st.error = null; } paint(); },
    });
  }

  async function run() {
    if (st.busy) return;
    Object.assign(st, { busy: true, error: null, log: [], pct: 0, mint: "approve" });
    paint();
    const live = () => {
      const b = q("#mp_bar"), ph = q("#mp_phase"), lg = q("#mp_log");
      if (b) b.textContent = bar(st.pct);
      if (ph) ph.textContent = st.log[st.log.length - 1] || "";
      if (lg) lg.innerHTML = st.log.map((l) => "<div>&gt; " + esc(l) + "</div>").join("");
    };
    try {
      const burner = await ensureBurner();
      const { mint } = await import("../../chain/nft.js");
      st.result = await mint({
        connection: rpcConnect(), wallet: session.wallet, burner, slug: st.col.slug, collection: st.col,
        onStage: (s, x) => {
          if (s === "funding") { st.mint = "approve"; paint(); return; }
          if (st.mint !== "confirm") { st.mint = "confirm"; paint(); }
          if (STAGE_PCT[s]) st.pct = Math.max(st.pct, STAGE_PCT[s]);
          if (STAGE_LINE[s]) { st.log.push(STAGE_LINE[s](x)); live(); }
        },
        onProgress: (p) => { st.pct = Math.max(st.pct, 25 + Math.round(p * 0.55)); live(); },
      });
      st.mint = "done";
      paint();
      nft.collection(st.col.slug).then((c) => { st.col = c; if (onMinted) onMinted(c); }).catch(() => {});
    } catch (e) {
      st.mint = "idle";
      // Holding too little of the token is not an error to read: go straight
      // to the swap, and keep the shortfall on the panel behind it.
      if (e && e.shortToken) { st.short = e.shortToken; st.busy = false; paint(); return getToken(); }
      st.error = String((e && e.message) || e) + " · Resume picks up where it stopped.";
      paint();
    }
    st.busy = false;
  }

  paint();
  return { repaint: paint };
}
