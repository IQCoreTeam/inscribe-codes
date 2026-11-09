// Token side (Board v5): markets + the launch-a-token flow. Under construction.
export async function mount(root) {
  root.innerHTML = `
<div style="max-width:1080px;margin:0 auto;padding:28px 24px">
  <div class="sm" style="display:flex;gap:24px"><a href="?view=home">&larr; HOME</a><a href="?view=nft">NFT LAUNCHPAD</a></div>
  <div style="margin-top:48px" class="win"><div class="wh"><span>token_launch.exe</span><span class="chip soon">UNDER CONSTRUCTION</span></div>
  <div style="padding:24px" class="big">The token launcher is moving here from iqlabs.dev. Until it lands, launch from the <a href="https://iqlabs.dev/?menu=codein" target="_blank" rel="noopener">iqlabs.dev board</a>.</div></div>
</div>`;
}
