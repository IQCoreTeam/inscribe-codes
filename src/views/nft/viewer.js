// Asset viewer (nft.exe): gateway-first for speed, plus the "recover without
// us" proof that re-reads everything from the chain alone and renders the
// image from the recovered bytes.
import { esc, shortAddr } from "../../ui/fmt.js";
import { connect as rpcConnect, explorerTx } from "../../chain/rpc.js";
import { frame } from "./launchpad.js";
import { paintWalletPill } from "./session.js";

export async function render(root, assetAddress) {
  const body = frame(root, '<div class="sm">reading the asset from chain...</div>');
  paintWalletPill(root.querySelector("#nf_wallet"));
  const connection = rpcConnect();
  const { viewAssetViaGateway, readAsset } = await import("../../chain/asset.js");

  let a;
  try { a = await viewAssetViaGateway(connection, assetAddress); }
  catch (e) {
    // gateway cold or down: fall back to the pure chain path immediately
    try { a = await readAsset(connection, assetAddress); a.imageUrl = a.imageDataUrl; }
    catch (e2) { body.innerHTML = '<div class="sm">could not read ' + esc(assetAddress) + ": " + esc(e2.message) + "</div>"; return; }
  }

  const attrs = Object.entries(a.attributes || {});
  const metaAttrs = (a.metadata && a.metadata.attributes) || [];
  body.innerHTML = `
  <div class="grid2" style="display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:16px;align-items:start">
    <div class="win">
      <div class="wh"><span>nft.exe</span></div>
      <div style="padding:12px">
        <div id="nv_img" style="aspect-ratio:1;background:var(--panel);display:grid;place-items:center;overflow:hidden">
          ${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated">` : '<span class="sm">no image pointer</span>'}
        </div>
        <div class="hero" style="font-size:24px;margin-top:10px">${esc(a.name)}</div>
        <div class="sm">held by ${esc(shortAddr(a.owner))}</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="win">
        <div class="wh"><span>on-chain attributes</span></div>
        <div style="padding:10px 14px" class="sm">
          <div class="kv"><span>asset</span><span>${esc(shortAddr(a.asset))}</span></div>
          <div class="kv"><span>collection</span><span>${a.collection ? esc(shortAddr(a.collection)) : "-"}</span></div>
          ${attrs.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span style="word-break:break-all;text-align:right">${esc(v.length > 50 ? shortAddr(v) : v)}</span></div>`).join("")}
          ${metaAttrs.filter((x) => !(x.trait_type in (a.attributes || {}))).map((x) => `<div class="kv"><span>${esc(x.trait_type)}</span><span style="word-break:break-all;text-align:right">${esc(String(x.value).length > 50 ? shortAddr(String(x.value)) : String(x.value))}</span></div>`).join("")}
        </div>
      </div>
      <div class="win">
        <div class="wh"><span>recover without us</span></div>
        <div style="padding:10px 14px" class="sm">
          <div>1. Read the asset account: its uri's last segment is the metadata inscription M.</div>
          <div>2. Decode M with the IQ SDK: its attributes.inscription is the image inscription C.</div>
          <div>3. Decode C: the body is the image itself. No gateway, no server, just an RPC.</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">
            <button class="cta" id="nv_prove" style="font-size:14px;padding:7px 12px">RUN IT FROM CHAIN NOW</button>
            <span id="nv_prove_s" style="align-self:center"></span>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
            ${a.C ? `<a href="${esc(explorerTx(a.C))}" target="_blank" rel="noopener">image tx (C)</a>` : ""}
            ${a.M ? `<a href="${esc(explorerTx(a.M))}" target="_blank" rel="noopener">metadata tx (M)</a>` : ""}
            <a href="https://solscan.io/account/${esc(a.asset)}" target="_blank" rel="noopener">asset on solscan</a>
            <a href="https://magiceden.io/item-details/${esc(a.asset)}" target="_blank" rel="noopener">magic eden</a>
          </div>
        </div>
      </div>
      <div class="win">
        <div class="wh"><span>metadata json</span></div>
        <pre style="margin:0;padding:12px;font:400 12px/1.5 monospace;color:var(--ink2);overflow:auto;max-height:240px">${esc(JSON.stringify(a.metadata, null, 2))}</pre>
      </div>
    </div>
  </div>`;

  const prove = body.querySelector("#nv_prove");
  const status = body.querySelector("#nv_prove_s");
  prove.onclick = async () => {
    prove.disabled = true;
    try {
      const r = await readAsset(connection, assetAddress, (s) => { status.textContent = "reading " + s + "..."; });
      status.textContent = r.imageDataUrl ? "recovered from chain alone ✓ (image below is the recovered bytes)" : "metadata recovered from chain ✓";
      if (r.imageDataUrl) body.querySelector("#nv_img").innerHTML = `<img src="${r.imageDataUrl}" alt="" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated">`;
    } catch (e) {
      // The default public RPC serves current state but prunes old transaction
      // history, so the proof needs a history-keeping RPC (helius, quicknode).
      status.textContent = /not found on this RPC/.test(e.message)
        ? "the default public RPC keeps no old tx history; set your own RPC (localStorage ic_rpc_mainnet-beta) and retry. the data IS on chain: open the tx links below on solscan."
        : "chain read failed: " + e.message;
    }
    prove.disabled = false;
  };
}
