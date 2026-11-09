// nft.iqlabs.dev client: collection registry, reservations, mint co-sign,
// creator staging/deploy. Plain HTTP; errors carry the server's own message.
const BASE = "https://nft.iqlabs.dev";

export async function api(path, body) {
  const res = await fetch(BASE + path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || "nft backend " + res.status + " on " + path);
  return data;
}

export const collections = () => api("/c");
export const collection = (slug) => api("/c/" + slug);
export const items = (slug, offset = 0, limit = 500) => api("/c/" + slug + "/items?offset=" + offset + "&limit=" + limit);
export const item = (slug, index) => api("/c/" + slug + "/item/" + index);
export const recent = (slug, limit = 8) => api("/c/" + slug + "/recent?limit=" + limit);
export const owner = (wallet) => api("/owner/" + wallet);
export const stats = () => api("/stats");
