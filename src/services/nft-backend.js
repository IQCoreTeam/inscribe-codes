// nft.iqlabs.dev client: collection registry, reservations, mint co-sign,
// creator staging/deploy. The backend never holds keys and never pays; the
// chain enforces uniqueness and where the money goes.
//
// call() returns { status, json, text } because the mint/deploy engines
// interpret status codes as protocol states (503 = retry with the reservation
// alive, 400 = terminal verification verdict). The read helpers throw instead.
const KEY = "ic_nft_api";
const PROD = "https://nft.iqlabs.dev";
// The backend's CORS allowlist is the deployed origins only; a localhost page
// goes through the dev server's same-origin proxy (scripts/dev.mjs).
const DEV = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "/__nft" : null;
export function apiBase() { try { return localStorage.getItem(KEY) || DEV || PROD; } catch (e) { return DEV || PROD; } }

export async function call(path, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(apiBase() + path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

async function read(path) {
  const r = await call(path);
  if (r.status !== 200) throw new Error((r.json && r.json.error) || "nft backend " + r.status + " on " + path);
  return r.json;
}

export const collections = async () => (await read("/c")).collections || [];
export const collection = (slug) => read("/c/" + slug);
export const items = (slug, offset = 0, limit = 500) => read("/c/" + slug + "/items?offset=" + offset + "&limit=" + limit);
export const item = (slug, index) => read("/c/" + slug + "/item/" + index);
export const recent = async (slug, limit = 8) => (await read("/c/" + slug + "/recent?limit=" + limit)).recent || [];
export const listings = (slug, limit = 200) => read("/c/" + slug + "/listings?limit=" + limit);
// The market's collection list: floor, listed count and 24h change per
// collection, the most recently sold first.
export const market = async () => (await read("/market")).collections || [];
export const held = async (wallet) => (await read("/owner/" + wallet)).items || [];
export const assetInfo = (address) => read("/asset/" + address);

// The stock-token currencies this visitor may price and pay in. The backend
// decides by region and returns an empty list where they are not offered. This
// is the page's only region signal: no view asks "which country", each one
// draws its stock controls from this list, and the backend withholds the rest.
//
//   place                      stocks offered              not offered
//   desk, PAY WITH row         shown, tickers = this list  absent
//   wizard, "Minters pay in"   SOL + this list             absent (SOL only)
//   stock collections          in /c, pages open           missing from /c, page 404
//   My NFTs, viewer            stock items included        stock items left out
//   market list / buy          the collection's currency   stock collections 404
//
// A collection's currency is fixed at deploy and is the only one it mints,
// lists and sells in here, so trade menus show it and never offer a choice.
// Fetched once per page.
let offered = null;
export const currencies = () => (offered ||= read("/creator/currencies").then((j) => j.currencies || [], () => []));

// A collection's non-SOL currency { mint, symbol, decimals, issuer }, or null
// when it prices in SOL.
export const curOf = (c) => (c && c.currency && c.currency.symbol && c.currency.symbol !== "SOL" ? c.currency : null);
