// "Get <token> with SOL" (design/NFT Launchpad Flow v6): a small window that
// swaps SOL into a collection's stock token so a visitor holding only SOL can
// mint or buy. It opens from the mint panel and the buy popup, prefilled with
// what that action needs.
//
// The design promises an exact amount received for a quoted SOL price. The
// swap route available for these tokens works the other way (see chain/swap.js),
// so here the SOL paid is exact and the amount received is a floor.
import { esc, fmtUsd } from "../../ui/fmt.js";
import { typeLabels } from "../../ui/tty.js";
import { usdPrice } from "../../services/markets.js";
import { connect as rpcConnect } from "../../chain/rpc.js";
import { session, addr, connectWallet } from "./session.js";

const MINT_SOL = 13_500_000; // what a mint still needs in SOL after the swap
const units = (raw, decimals) => String(+(raw / 10 ** decimals).toFixed(6));

// cur: the collection's currency { mint, symbol, decimals }. want: raw units to
// prefill. purpose: "mint" | "buy" (the copy and the SOL the action still
// needs). onClose(got) runs when the window closes, got = a swap completed.
export function openSwap({ cur, want, purpose, onClose }) {
  const modal = document.querySelector("#nf_modal");
  const st = { amt: units(want, cur.decimals), quote: null, sol: null, phase: "idle", error: null, got: null, seq: 0 };
  const close = () => { modal.innerHTML = ""; document.removeEventListener("keydown", onEsc); onClose(st.got != null); };
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onEsc);
  const raw = () => Math.round(parseFloat(st.amt || "0") * 10 ** cur.decimals) || 0;
  const sol = (lamports) => (lamports / 1e9).toFixed(4) + " SOL";
  const kv = (k, v, cls = "") => `<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;

  function paint() {
    const q = st.quote, pay = q && Number(q.inAmount), left = q && st.sol != null ? st.sol - pay : null;
    const over = left != null && left < 0, warn = purpose === "mint" && left != null && left >= 0 && left < MINT_SOL;
    const focus = document.activeElement && document.activeElement.id === "sw_amt";
    modal.innerHTML = `<div class="nf-overlay" id="sw_ov"><div class="win mk-pop sw-pop">
      <div class="wh"><span data-tty>Get</span><span class="t-${esc(cur.symbol)} sw-sym">${esc(cur.symbol)}</span><span class="wh-right wh-x" id="sw_x">x</span></div>
      <div class="sw-body">
        <div>
          <div class="lab" style="letter-spacing:.1em;margin-bottom:4px">You get at least</div>
          <div class="sw-amt"><input class="inp" id="sw_amt" inputmode="decimal" value="${esc(st.amt)}" ${st.phase === "idle" && st.got == null ? "" : "disabled"}><span class="t-${esc(cur.symbol)}">${esc(cur.symbol)}</span><span class="approx" id="sw_usd"></span></div>
          <div class="cm mk-fine" style="margin-top:6px">Filled in with what this ${purpose} needs. Change it if you want more.</div>
        </div>
        <div class="mk-cost">
          ${kv("you pay", q ? `<span style="color:var(--ink)">${sol(pay)}</span>` : raw() ? '<span class="ttyspin"></span>' : "-")}
          ${kv("rate", q ? `1 ${esc(cur.symbol)} ≈ ${(pay / 1e9 / (Number(q.outAmount) / 10 ** cur.decimals)).toFixed(3)} SOL` : "-")}
          ${kv("expected (0.5% slippage allowed)", q ? units(Number(q.outAmount), cur.decimals) + " " + esc(cur.symbol) : "-")}
          ${kv("SOL left in wallet", left != null ? `<span style="${left < MINT_SOL ? "color:var(--cta)" : ""}">${(Math.max(left, 0) / 1e9).toFixed(3)} SOL</span>` : st.sol != null ? (st.sol / 1e9).toFixed(3) + " SOL" : "-", "mk-total")}
        </div>
        ${warn ? '<div class="cm mk-fine" style="color:var(--cta)">Minting also needs about 0.0135 SOL. This swap would leave less than that.</div>' : ""}
        ${over ? '<div class="cm mk-fine" style="color:var(--cta)">Not enough SOL in your wallet for this amount.</div>' : ""}
        ${st.error ? `<div class="cm mk-fine" style="color:var(--bad)">${esc(st.error)}</div>` : ""}
        ${st.got != null ? `<div class="mk-done">Got ${esc(units(st.got, cur.decimals))} ${esc(cur.symbol)} ✓</div><div class="btn mk-wide" id="sw_back">Back to ${purpose} →</div>`
          : !addr() ? '<div class="btn mk-wide" id="sw_conn">Connect wallet</div>'
          : st.phase === "waiting" ? '<div class="ttyspin nf-approve">Approve in your wallet…</div>'
          : st.phase === "confirming" ? '<div class="ttyspin cm" style="text-align:center;padding:12px 0">Swapping on Solana…</div>'
          : `<div class="${q && !over ? "btn" : "btn2 mk-off"} mk-wide" id="sw_go">${q ? "Swap · pay " + sol(pay) : raw() ? "Getting a quote…" : "Enter an amount"}</div>`}
        <div class="cm mk-fine sw-foot">You pay exactly the SOL above, fixed when you sign, and receive at least the amount you entered. ${esc(cur.symbol)} is not issued or custodied by inscribe.codes. Eligibility follows the issuer's terms.</div>
      </div></div></div>`;
    typeLabels(modal);
    const ov = modal.querySelector("#sw_ov");
    ov.onclick = (e) => { if (e.target === ov || e.target.id === "sw_x" || e.target.id === "sw_back") close(); };
    usdPrice(cur.mint).then((p) => { const u = modal.querySelector("#sw_usd"); if (u && p && raw()) u.textContent = "≈ " + fmtUsd((raw() / 10 ** cur.decimals) * p); });
    const amt = modal.querySelector("#sw_amt");
    amt.oninput = () => { st.amt = amt.value; requote(400); };
    if (focus) { amt.focus(); amt.setSelectionRange(amt.value.length, amt.value.length); }
    const on = (id, fn) => { const n = modal.querySelector(id); if (n) n.onclick = fn; };
    on("#sw_conn", () => connectWallet().then(() => { loadSol(); paint(); }).catch((e) => alert(e.message)));
    on("#sw_go", () => q && !over && go());
  }

  // Quotes go stale and typing races them: only the latest request may land.
  let timer = null;
  function requote(delay = 0) {
    clearTimeout(timer);
    const seq = ++st.seq, want = raw();
    st.quote = null; st.error = null;
    paint();
    if (!want) return;
    timer = setTimeout(async () => {
      try {
        const { quoteAtLeast } = await import("../../chain/swap.js");
        const q = await quoteAtLeast(cur.mint, want);
        if (seq === st.seq) st.quote = q;
      } catch (e) { if (seq === st.seq) st.error = String((e && e.message) || e); }
      if (seq === st.seq && modal.querySelector("#sw_ov")) paint();
    }, delay);
  }
  const loadSol = () => addr() && rpcConnect().getBalance(session.wallet.publicKey).then((b) => { st.sol = b; if (modal.querySelector("#sw_ov") && st.phase === "idle") paint(); }).catch(() => {});

  async function go() {
    st.phase = "waiting"; st.error = null; paint();
    try {
      const { swap } = await import("../../chain/swap.js");
      const { tokenBalance } = await import("../../chain/token.js");
      const { PublicKey } = await import("@solana/web3.js");
      const connection = rpcConnect(), mint = new PublicKey(cur.mint), owner = session.wallet.publicKey;
      const before = await tokenBalance(connection, owner, mint);
      await swap(connection, session.wallet, st.quote, () => { st.phase = "confirming"; paint(); });
      st.got = Math.max((await tokenBalance(connection, owner, mint)) - before, Number(st.quote.otherAmountThreshold));
    } catch (e) { st.error = String((e && e.message) || e); st.quote = null; }
    st.phase = "idle";
    paint();
    if (st.got == null) requote();
  }

  loadSol();
  requote();
}
