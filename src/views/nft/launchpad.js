// NFT side (NFT Launchpad Flow v5). Under construction.
export async function mount(root) {
  root.innerHTML = `
<div style="max-width:1080px;margin:0 auto;padding:28px 24px">
  <div class="sm" style="display:flex;gap:24px"><a href="?view=home">&larr; HOME</a><a href="?view=token">TOKEN LAUNCH</a></div>
  <div style="margin-top:48px" class="win"><div class="wh"><span>nft.exe</span><span class="chip soon">UNDER CONSTRUCTION</span></div>
  <div style="padding:24px" class="big">The NFT launchpad is moving here from iqlabs.dev. Until it lands, mint at <a href="https://iqlabs.dev/?menu=nft" target="_blank" rel="noopener">iqlabs.dev</a>.</div></div>
</div>`;
}
