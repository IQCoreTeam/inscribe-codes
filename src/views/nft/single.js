// Single 1/1 mint: turn an inscription the wallet already made (C) into an NFT
// in the global single collection. Entry: ?view=nft&single=<C> (the iqlabs.dev
// viewer's MINT AS NFT button links here).
import { esc, shortAddr } from "../../ui/fmt.js";
import { readRow } from "../../services/gateway.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { frame } from "./launchpad.js";
import { session, addr, connectWallet, ensureBurner, paintWalletPill } from "./session.js";

export async function render(root, C) {
  const body = frame(root, '<div class="sm">reading the inscription...</div>');
  paintWalletPill(root.querySelector("#nf_wallet"), () => paint(root, body, C));
  st.row = await readRow(C).catch(() => null);
  paint(root, body, C);
}

const st = { row: null, name: "", busy: false };

function paint(root, body, C) {
  if (!body.isConnected) return;
  const row = st.row;
  if (!row || !row.kind) {
    body.innerHTML = `<div class="win"><div class="wh"><span>single.exe</span></div><div style="padding:16px" class="sm">
      No inscription found for <span style="word-break:break-all">${esc(C)}</span>. It may still be indexing; retry in a minute, or check the tx on <a href="${esc(explorerTx(C))}" target="_blank" rel="noopener">solscan</a>.</div></div>`;
    return;
  }
  const isImg = typeof row.body === "string" && row.body.startsWith("data:image/");
  const mine = addr() && String(row.who || "").toLowerCase() === addr().toLowerCase();
  body.innerHTML = `
  <div class="win" style="max-width:640px;margin:0 auto">
    <div class="wh"><span>single.exe · mint 1/1</span></div>
    <div style="padding:16px">
      <div style="display:flex;gap:14px;align-items:flex-start">
        <div style="flex:0 0 140px;aspect-ratio:1;background:var(--panel);display:grid;place-items:center;overflow:hidden;border:1px solid var(--line)">
          ${isImg ? `<img src="${row.body}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span class="sm">${esc(row.kind)}</span>`}
        </div>
        <div class="sm" style="flex:1;min-width:0">
          <div class="kv"><span>inscription</span><span>${esc(shortAddr(C))}</span></div>
          <div class="kv"><span>kind</span><span>${esc(row.kind)}</span></div>
          <div class="kv" style="border-bottom:none"><span>inscribed by</span><span>${esc(shortAddr(row.who || ""))}</span></div>
        </div>
      </div>
      ${!addr() ? '<div class="sm" style="margin-top:14px;border:1px dashed var(--acc);padding:14px;text-align:center">Connect the wallet that made this inscription to mint it. <span class="lnk" id="ns_conn">Connect wallet</span></div>'
      : !mine ? '<div class="sm" style="margin-top:14px;color:var(--cta)">Only the wallet that made this inscription (' + esc(shortAddr(row.who || "")) + ") can mint it as an NFT.</div>"
      : `
      <div class="sm" style="margin-top:14px">NFT name</div>
      <input id="ns_name" value="${esc(st.name)}" maxlength="60" placeholder="my inscription #1" style="width:100%;box-sizing:border-box;background:var(--panel2);color:var(--acc);border:1px solid var(--line);font:inherit;font-size:18px;padding:9px 10px">
      <div class="sm" style="margin-top:10px">One funding signature covers the metadata inscription and the register rents (~0.02 SOL budget, leftover sweeps back). No price: this is your own content.</div>
      <div id="ns_status" class="sm" style="margin-top:8px"></div>
      <button class="cta" id="ns_mint" style="width:100%;margin-top:10px;text-align:center">MINT AS NFT</button>`}
    </div>
  </div>`;
  const conn = body.querySelector("#ns_conn");
  if (conn) conn.onclick = () => connectWallet().then(() => { paintWalletPill(root.querySelector("#nf_wallet")); paint(root, body, C); }).catch((e) => alert(e.message));
  const name = body.querySelector("#ns_name");
  if (name) name.oninput = () => { st.name = name.value; };
  const btn = body.querySelector("#ns_mint");
  if (btn) btn.onclick = () => run(root, body, C, row);
}

const LINES = { funding: "funding the burner (approve one transfer)", metadata: "inscribing the metadata", register: "registering (backend co-sign)", confirming: "confirming on chain" };

async function run(root, body, C, row) {
  if (st.busy) return;
  st.busy = true;
  const status = body.querySelector("#ns_status");
  const btn = body.querySelector("#ns_mint");
  btn.disabled = true;
  try {
    if (!st.name.trim()) throw new Error("give the NFT a name first");
    const connection = rpcConnect();
    const burner = await ensureBurner();
    const { mintSingle } = await import("../../chain/nft.js");
    const result = await mintSingle({
      connection, wallet: session.wallet, burner, C, name: st.name.trim(), kind: row.kind,
      onStage: (s) => { if (LINES[s]) status.textContent = LINES[s]; },
    });
    body.innerHTML = `
    <div class="win" style="max-width:640px;margin:0 auto"><div class="wh"><span>single.exe</span></div>
      <div style="padding:20px;text-align:center">
        <div class="hero" style="font-size:36px">Minted.</div>
        <div class="big" style="margin-top:6px">${esc(result.name)}</div>
        <div class="sm" style="margin-top:12px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <a class="cta" style="font-size:16px;padding:8px 14px" href="?view=nft&asset=${esc(result.asset)}">VIEW NFT</a>
          <a href="${esc(explorerTx(result.mintSig))}" target="_blank" rel="noopener" style="align-self:center">register tx</a>
        </div>
      </div></div>`;
  } catch (e) {
    if (status) status.innerHTML = '<span style="color:var(--bad)">' + esc(String((e && e.message) || e)) + "</span> · retry resumes where it stopped";
    if (btn) btn.disabled = false;
  }
  st.busy = false;
}
