// iq-gateway client (cache layer over the chain; anyone can run one, data
// survives it). Reads come from here so the site never hammers public RPC.
import { feedTablePda } from "../chain/feed.js";

const GATEWAYS = ["https://gateway.iqlabs.dev"];
const feedTable = feedTablePda.toBase58();

async function gwFetch(path) {
  let lastErr;
  for (const base of GATEWAYS) {
    try {
      const res = await fetch(base + path);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("gateway " + res.status);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("gateway unreachable");
}

const normalize = (items) => (items || []).map((it) => it.row || it);

export async function readBoard(limit = 24, before) {
  const data = await gwFetch("/table/" + feedTable + "/rows?limit=" + limit + (before ? "&before=" + encodeURIComponent(before) : ""));
  return { rows: normalize(data && data.rows), nextCursor: (data && data.nextCursor) || null };
}

// Per-wallet inscriptions: the gateway indexes by the wallet-derived inventory
// PDA, so burner-signed writes list under the owner. /assets gives signatures;
// /slice decodes them; rows without a kind (init/session txs) decode empty.
export async function readMine(pubkey, limit = 24) {
  const idx = await gwFetch("/user/" + pubkey + "/assets?limit=" + limit);
  const sigs = ((idx && idx.assets) || idx || []).map((a) => a.signature || a.txSignature || a).filter(Boolean);
  if (!sigs.length) return { rows: [] };
  const data = await gwFetch("/table/" + feedTable + "/slice?sigs=" + sigs.join(","));
  return { rows: normalize(data && data.rows).filter((r) => r && r.kind) };
}

// Launched coins: kind=token rows are the launch registry, but they sit at
// whatever depth the board's chatter pushed them to, so walk the cursor until
// enough are found. Returns parsed bodies ({mint,name,symbol,src,meta}).
export async function readTokens(want = 30, maxPages = 8) {
  const tokens = [];
  let before = null;
  for (let page = 0; page < maxPages && tokens.length < want; page++) {
    const { rows, nextCursor } = await readBoard(60, before);
    for (const r of rows) {
      if (!r || r.kind !== "token") continue;
      try { const t = JSON.parse(r.body); if (t.mint && !tokens.some((x) => x.mint === t.mint)) tokens.push(t); } catch (e) {}
    }
    if (!nextCursor) break;
    before = nextCursor;
  }
  return tokens;
}

export async function readRow(sig) {
  const data = await gwFetch("/table/" + feedTable + "/slice?sigs=" + sig);
  const rows = normalize(data && data.rows);
  return rows[0] || null;
}

// Warm the gateway's durable index right after a confirmed write; best-effort.
// extra.signer (the owner wallet) invalidates that wallet's inventory cache.
export function notify(sig, row, extra = {}) {
  return fetch(GATEWAYS[0] + "/table/" + feedTable + "/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txSignature: sig, row, ...extra }),
  }).catch(() => {});
}

export const imgUrl = (sig) => GATEWAYS[0] + "/img/" + sig + ".png";
export const metaUrl = (sig) => GATEWAYS[0] + "/token-meta/" + sig;
export const renderUrl = (sig) => GATEWAYS[0] + "/render/" + sig;
