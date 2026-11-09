// Read an inscription NFT: the Core asset account from chain, then either the
// gateway cache (fast default) or the chain itself (the "recover without us"
// proof: asset -> uri's last segment = M -> metadata JSON -> attributes.
// inscription = C -> the image row, all decoded with the SDK reader).
//
// The Core asset account is parsed directly (web3 PublicKey for base58), no
// mpl-core/umi in the browser. The base-field + Attributes parser was verified
// byte-for-byte against mpl-core deserializeAssetV1 on a live asset, so it is
// exact, not a heuristic.
import { PublicKey } from "@solana/web3.js";
import { reader } from "@iqlabs-official/solana-sdk";
import { metaUrl, imgUrl } from "../services/gateway.js";

const u32 = (d, o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | d[o + 3] * 0x1000000;
const utf8 = (b) => new TextDecoder().decode(b);

// Core AssetV1 base fields: key(1) owner(32) updateAuthority(enum) name uri seq.
function parseAssetBase(d) {
  let o = 0;
  const key = d[o++];
  const owner = new PublicKey(d.slice(o, o + 32)).toBase58(); o += 32;
  const uaKind = d[o++]; // 0 None, 1 Address, 2 Collection
  let collection = null;
  if (uaKind === 1 || uaKind === 2) { collection = new PublicKey(d.slice(o, o + 32)).toBase58(); o += 32; }
  const nl = u32(d, o); o += 4; const name = utf8(d.slice(o, o + nl)); o += nl;
  const ul = u32(d, o); o += 4; const uri = utf8(d.slice(o, o + ul)); o += ul;
  const seq = d[o++]; if (seq === 1) o += 8; // Option<u64>
  return { key, owner, collection, name, uri, pluginOffset: o };
}

// The Attributes plugin (our only plugin on an item): plugin header (key 3 +
// u64 registry offset), Plugin::Attributes discriminant, then Vec<{key,value}>.
// Best-effort: {} if the layout ever differs, so recovery never depends on it.
function parseAttributes(d, o) {
  try {
    if (d[o] !== 3) return {};
    o += 1 + 8 + 1;
    const n = u32(d, o); o += 4;
    const out = {};
    for (let i = 0; i < n; i++) {
      const kl = u32(d, o); o += 4; const k = utf8(d.slice(o, o + kl)); o += kl;
      const vl = u32(d, o); o += 4; const v = utf8(d.slice(o, o + vl)); o += vl;
      out[k] = v;
    }
    return out;
  } catch (e) { return {}; }
}

export async function readInscription(connection, sig) {
  const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 1 });
  if (!tx) throw new Error("inscription tx not found on this RPC: " + sig);
  const res = await reader.readUserInventoryCodeInFromTx(tx);
  return res.data; // the inscribed body, verbatim
}

// One getAccountInfo: name, owner, collection, uri, our Attributes, and
// M = the metadata inscription (last path segment of the uri). The shared
// first step of both viewer paths.
export async function readAssetAccount(connection, assetAddress) {
  const pk = new PublicKey(assetAddress); // throws on a malformed address
  const ai = await connection.getAccountInfo(pk);
  if (!ai) throw new Error("no account at that address");
  const data = new Uint8Array(ai.data);
  if (data[0] !== 1) throw new Error("not a Metaplex Core asset");
  const base = parseAssetBase(data);
  const attrs = parseAttributes(data, base.pluginOffset);
  const M = (base.uri.split("/").pop() || "").trim();
  if (!M) throw new Error("asset has no metadata uri");
  return { asset: assetAddress, name: base.name, owner: base.owner, collection: base.collection, uri: base.uri, attributes: attrs, M };
}

// Default viewer path: account from chain, metadata + image from the gateway
// cache (1 rpc call + 2 cached gets); the gateway only serves what is on chain.
export async function viewAssetViaGateway(connection, assetAddress) {
  const account = await readAssetAccount(connection, assetAddress);
  const res = await fetch(metaUrl(account.M));
  if (!res.ok) throw new Error("gateway has no metadata for " + account.M + " (http " + res.status + ")");
  const metadata = await res.json();
  const C = ((metadata.attributes || []).find((a) => a.trait_type === "inscription") || {}).value || null;
  return { ...account, C, metadata, imageUrl: C ? imgUrl(C) : null };
}

// The same thing decoded from chain only (the "recover without us" proof).
// onStep(name): account, metadata, image.
export async function readAsset(connection, assetAddress, onStep) {
  const step = (s) => { try { onStep && onStep(s); } catch (e) {} };
  step("account");
  const account = await readAssetAccount(connection, assetAddress);

  step("metadata");
  const metaStr = await readInscription(connection, account.M);
  let metadata;
  try { metadata = JSON.parse(metaStr); } catch (e) { throw new Error("metadata inscription is not valid JSON"); }
  const C = ((metadata.attributes || []).find((a) => a.trait_type === "inscription") || {}).value || null;

  let imageDataUrl = null;
  if (C) {
    step("image");
    try {
      const row = JSON.parse(await readInscription(connection, C));
      imageDataUrl = row.body || null; // "data:<mime>;base64,..."
    } catch (e) { imageDataUrl = null; } // best-effort; metadata already carries the pointer
  }
  return { ...account, C, metadata, imageDataUrl };
}
