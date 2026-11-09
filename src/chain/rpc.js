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

export const connect = () => new Connection(active, "confirmed");
export const hasOwnRpc = () => active !== DEFAULT_RPC;

export function setRpc(url) {
  active = url || DEFAULT_RPC;
  try { url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY); } catch (e) {}
  setRpcUrl(active);
}

export const explorerTx = (sig) => "https://solscan.io/tx/" + sig + (CLUSTER === "devnet" ? "?cluster=devnet" : "");
