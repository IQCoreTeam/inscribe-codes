// Single 1/1 mint: turn an inscription the wallet already made (C) into an NFT
// in the global single collection. Entry: ?view=nft&single=<C> (the iqlabs.dev
// viewer's MINT AS NFT button links here).
import { esc, shortAddr } from "../../ui/fmt.js";
import { readRow } from "../../services/gateway.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { frame } from "./launchpad.js";
import { session, addr, connectWallet, ensureBurner, paintWalletPill } from "./session.js";

export async function render(root, C) {
  const body = frame(root, '<div class="nf-note">reading the inscription...</div>');
  paintWalletPill(root.querySelector("#nav_wallet"), () => paint(root, body, C));
  st.row = await readRow(C).catch(() => null);
  paint(root, body, C);
}

const st = { row: null, name: "", busy: false };

function paint(root, body, C) {
  if (!body.isConnected) return;
  const row = st.row;
  const win = (inner) => `<div class="win nf-win nf-single"><div class="wh"><span>Single 1 / 1</span><a class="wh-right wh-x" href="?view=nft">← launchpad</a></div><div class="nf-wizbody">${inner}</div></div>`;
  if (!row || !row.kind) {
    body.innerHTML = win(`<div class="cm">No inscription found for <span style="word-break:break-all;color:var(--ink2)">${esc(C)}</span>. It may still be indexing; retry in a minute, or check the tx on <a href="${esc(explorerTx(C))}" target="_blank" rel="noopener" style="color:var(--acc)">solscan</a>.</div>`);
    return;
  }
  const isImg = typeof row.body === "string" && row.body.startsWith("data:image/");
  const mine = addr() && String(row.who || "").toLowerCase() === addr().toLowerCase();
  body.innerHTML = win(`
    <div class="nf-singlegrid">
      <div class="ah-prev">${isImg ? `<img src="${row.body}" alt="">` : `<div class="cm" style="padding:12px">${esc(row.kind)} inscription</div>`}</div>
      <div>
        <div class="kv"><span>inscription</span><span>${esc(shortAddr(C))}</span></div>
        <div class="kv"><span>kind</span><span>${esc(row.kind)}</span></div>
        <div class="kv"><span>inscribed by</span><span>${esc(shortAddr(row.who || ""))}</span></div>
        <div class="kv"><span>collection</span><span>IQ6900 Inscriptions</span></div>
      </div>
    </div>
    ${!addr() ? '<div class="nf-connectmint" id="ns_conn" style="margin-top:16px">Connect the wallet that made this inscription</div>'
      : !mine ? `<div class="cm" style="margin-top:16px;color:#b07a1a">Only the wallet that made this inscription (${esc(shortAddr(row.who || ""))}) can mint it as an NFT.</div>`
      : `<div style="margin-top:16px"><div class="fl">NFT name</div><input class="inp" id="ns_name" value="${esc(st.name)}" maxlength="60" placeholder="my inscription #1"></div>
      <div class="cm" style="margin-top:10px">One funding signature covers the details inscription and the register rents (about 0.02 SOL budget; the leftover sweeps back). No price: this is your own content.</div>
      <div class="cm" id="ns_status" style="margin-top:8px"></div>
      <button class="btn nf-mintbtn" id="ns_mint" style="margin-top:10px">Mint as NFT</button>`}`);
  const conn = body.querySelector("#ns_conn");
  if (conn) conn.onclick = () => connectWallet().then(() => { paintWalletPill(root.querySelector("#nav_wallet"), () => paint(root, body, C)); paint(root, body, C); }).catch((e) => alert(e.message));
  const name = body.querySelector("#ns_name");
  if (name) name.oninput = () => { st.name = name.value; };
  const btn = body.querySelector("#ns_mint");
  if (btn) btn.onclick = () => run(root, body, C, row);
}

const LINES = { funding: "approve the funding transfer in your wallet…", metadata: "inscribing the details", register: "registering (co-sign)", confirming: "confirming on chain" };

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
    body.innerHTML = `<div class="win nf-win nf-single"><div class="wh"><span>Single 1 / 1</span></div><div class="nf-wizbody" style="text-align:center">
        <div data-tty class="nf-minted">Minted.</div><div class="cm" style="margin-top:10px">${esc(result.name)}</div>
        <div class="nf-btnrow lab" style="margin-top:16px"><a class="btng" href="?view=nft&asset=${esc(result.asset)}">View NFT →</a><a class="btn2" href="${esc(explorerTx(result.mintSig))}" target="_blank" rel="noopener">Solscan</a></div>
      </div></div>`;
  } catch (e) {
    if (status) status.innerHTML = '<span style="color:var(--bad)">' + esc(String((e && e.message) || e)) + "</span> · retry resumes where it stopped";
    if (btn) btn.disabled = false;
  }
  st.busy = false;
}
