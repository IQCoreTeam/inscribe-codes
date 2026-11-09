// nft.iqlabs.dev client: collection registry, reservations, mint co-sign,
// creator staging/deploy. The backend never holds keys and never pays; the
// chain enforces uniqueness and where the money goes.
//
// call() returns { status, json, text } because the mint/deploy engines
// interpret status codes as protocol states (503 = retry with the reservation
// alive, 400 = terminal verification verdict). The read helpers throw instead.
const KEY = "ic_nft_api";
export function apiBase() { try { return localStorage.getItem(KEY) || "https://nft.iqlabs.dev"; } catch (e) { return "https://nft.iqlabs.dev"; } }

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
export const held = async (wallet) => (await read("/owner/" + wallet)).items || [];
export const assetInfo = (address) => read("/asset/" + address);
