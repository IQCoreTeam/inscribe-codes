// Solana RPC selection. The public mainnet RPC rejects any browser Origin, so
// the default is a keyless CORS-open endpoint; users can register their own
// (persisted per cluster so a devnet-era override never leaks into mainnet).
import { Connection } from "@solana/web3.js";
import { setRpcUrl } from "@iqlabs-official/solana-sdk";

export const DEFAULT_RPC = "https://solana-rpc.publicnode.com";
export const CLUSTER = DEFAULT_RPC.includes("devnet") ? "devnet" : "mainnet-beta";
const KEY = "ic_rpc_" + CLUSTER;

let active = DEFAULT_RPC;
try { active = localStorage.getItem(KEY) || DEFAULT_RPC; } catch (e) {}
setRpcUrl(active);

export const hasOwnRpc = () => active !== DEFAULT_RPC;

export function setRpc(url) {
  active = url || DEFAULT_RPC;
  try { url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY); } catch (e) {}
  setRpcUrl(active);
}

// A wrong custom RPC must not brick the page. Every call a Connection makes goes
// to the active RPC, so a 403/401 through this fetch means that RPC rejected us:
// drop it and reload on the default, once per load. The default is keyless and
// CORS-open, so it never trips this. web3 captures a fetch at its own import, so
// the Connection must be given this one explicitly (a global patch is too late).
let rpcDropped = false;
async function rpcFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!rpcDropped && hasOwnRpc() && (res.status === 403 || res.status === 401)) {
    rpcDropped = true;
    setRpc(null);
    location.reload();
  }
  return res;
}

export const connect = () => new Connection(active, { commitment: "confirmed", fetch: rpcFetch });

export const explorerTx = (sig) => "https://solscan.io/tx/" + sig + (CLUSTER === "devnet" ? "?cluster=devnet" : "");
