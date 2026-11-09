// Price rows for launched coins, any chain both sources name the same way
// ("solana", "robinhood"). DexScreener lists DEX pools only, so a coin still
// on its bonding curve is absent there; GeckoTerminal indexes the curve itself
// as a pool, so it fills the gap and a coin charts from launch.
// Row: { mint, priceUsd, mcap, chg24, vol24, icon, embed, url, siteLabel, via }.

async function dexscreenerRows(chain, mints) {
  const site = "https://dexscreener.com/" + chain + "/";
  const out = [];
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30); // tokens/v1 caps at 30 addresses
    try {
      const res = await fetch("https://api.dexscreener.com/tokens/v1/" + chain + "/" + batch.join(","));
      if (!res.ok) continue;
      const pairs = await res.json();
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const mint = callerMint(batch, p.baseToken && p.baseToken.address);
        if (!mint || !p.pairAddress) continue;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        const prev = out.find((x) => x.mint === mint);
        if (prev && liq < prev.liq) continue; // deepest-liquidity pair wins
        const pc = p.priceChange || {};
        const row = {
          mint, liq,
          embed: site + p.pairAddress + "?embed=1&theme=dark&trades=0&info=0",
          url: p.url || site + p.pairAddress,
          via: "via dexscreener", siteLabel: "OPEN ON DEXSCREENER",
          priceUsd: p.priceUsd, chg24: pc.h24 != null ? Number(pc.h24) : null,
          mcap: p.marketCap, vol24: p.volume && p.volume.h24, icon: p.info && p.info.imageUrl,
        };
        if (prev) Object.assign(prev, row); else out.push(row);
      }
    } catch (e) { /* leave this batch out */ }
  }
  return out;
}

async function geckoterminalRows(network, mints) {
  const site = "https://www.geckoterminal.com/" + network + "/pools/";
  const out = [];
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30); // tokens/multi caps at 30
    try {
      const res = await fetch("https://api.geckoterminal.com/api/v2/networks/" + network + "/tokens/multi/"
        + batch.join(",") + "?include=top_pools", { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const j = await res.json();
      const pools = {};
      for (const p of j.included || []) pools[p.id] = p.attributes || {};
      for (const tok of j.data || []) {
        const a = tok.attributes || {};
        const mint = callerMint(batch, a.address);
        const rel = ((tok.relationships || {}).top_pools || {}).data || [];
        const pool = rel.length ? pools[rel[0].id] : null;
        if (!mint || !pool || !pool.address) continue;
        const pc = pool.price_change_percentage || {};
        const vol = pool.volume_usd || {};
        out.push({
          mint, liq: Number(pool.reserve_in_usd) || 0,
          embed: site + pool.address + "?embed=1&info=0&swaps=0&light_chart=0",
          url: site + pool.address,
          via: "via geckoterminal", siteLabel: "OPEN ON GECKOTERMINAL",
          // a pool nobody has traded yet has no price, so no change either
          priceUsd: a.price_usd, chg24: a.price_usd != null && pc.h24 != null ? Number(pc.h24) : null,
          mcap: Number(a.market_cap_usd || a.fdv_usd) || null,
          vol24: Number(vol.h24) || null,
          icon: /^https?:\/\//.test(a.image_url || "") ? a.image_url : null, // it sends "missing.png" for none
        });
      }
    } catch (e) { /* leave this batch out */ }
  }
  return out;
}

// Hand a row back under the caller's own string: evm addresses come back in
// another casing than was asked for.
function callerMint(batch, addr) {
  if (!addr) return null;
  return batch.find((m) => m === addr) || batch.find((m) => m.toLowerCase() === addr.toLowerCase()) || null;
}

export async function marketRows(chain, mints) {
  if (!mints.length) return [];
  const out = await dexscreenerRows(chain, mints);
  const rest = mints.filter((m) => !out.some((r) => r.mint === m));
  return rest.length ? out.concat(await geckoterminalRows(chain, rest)) : out;
}

export const tradeUrl = (chain, mint) =>
  chain === "robinhood" ? "https://www.ponsfamily.com/launchpad/" + mint : "https://pump.fun/coin/" + mint;
export const tradeLabel = (chain) => (chain === "robinhood" ? "TRADE ON PONS" : "TRADE ON PUMP.FUN");
