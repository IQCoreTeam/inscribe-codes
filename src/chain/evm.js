// Robinhood Chain adapter (an Arbitrum Orbit L2): EVM wallet discovery, the
// Model B hybrid write, and the EVM feed reads. Same feed labels as Solana.
//
// Hybrid signing: a deterministic burner signs the big-calldata chunk txs + the
// shared board row (dbCodeIn) through the public RPC (no "risky" wallet warning,
// no per-batch popups), while the USER WALLET signs only the small native
// inventory finalize. The user signs ~3 clean txs regardless of file size.
// BURNER_MSG is a cross-site protocol constant (same burner as iqlabs.dev).
import { BrowserProvider, JsonRpcProvider, Wallet, formatEther, parseEther, keccak256, toUtf8Bytes } from "ethers";
import * as sdk from "@iqlabs-official/ethereum-sdk";

export const DB_ROOT_ID = "iq6900-codein-feed-v1";
export const TABLE = "global-feed";
const CHAIN_ID = "0x1237"; // 4663
const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER_TX = "https://robinhoodchain.blockscout.com/tx/";
const RPC_KEY = "ic_rpc_robinhood";
const GATEWAY = "https://gateway.iqlabs.dev";
const NET = "network=robinhood";
const BURNER_MSG = "IQ6900 hood-in inscription burner v1";
const WALLET_KEY = "ic_evm_wallet";
const WALLET_CHANGED = "Wallet account or network changed. Reconnect your wallet before inscribing.";

let activeRpc = DEFAULT_RPC;
try { activeRpc = localStorage.getItem(RPC_KEY) || DEFAULT_RPC; } catch (e) {}
sdk.setNetwork("robinhood", activeRpc);

let signer = null;
let injected = null;
let burnerWallet = null;
let inscribeCheckpoint = null; // { row, at: HybridCheckpoint } survives RETRY for the same row
let walletGeneration = 0;
let disconnected = false;
const found = new Map();
window.addEventListener("eip6963:announceProvider", ({ detail }) => {
  if (!detail || !detail.info || !detail.info.rdns || typeof (detail.provider || {}).request !== "function") return;
  if ([...found.values()].some((w) => w.provider === detail.provider)) return;
  found.set(detail.info.rdns, { id: detail.info.rdns, name: detail.info.name, provider: detail.provider });
});
try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {}

export function evmWallets() {
  if (found.size) return [...found.values()];
  const eths = (window.ethereum && window.ethereum.providers) || (window.ethereum ? [window.ethereum] : []);
  return eths.map((eth, i) => ({ id: "injected-" + i, name: eth.isPhantom ? "Phantom" : eth.isMetaMask ? "MetaMask" : "Browser wallet", provider: eth }));
}

export const evmSigner = () => signer;
export const evmAddress = () => (signer ? signer.address : null);

export async function connectEvm({ silent = false, walletId } = {}) {
  const options = evmWallets();
  let saved; try { saved = localStorage.getItem(WALLET_KEY); } catch (e) {}
  if (silent && (disconnected || saved === "disconnected")) return null;
  const choice = options.find((w) => w.id === (walletId || saved)) || (!walletId && !saved && options.length === 1 ? options[0] : null) || (!silent && options.length ? options[0] : null);
  if (!choice) { if (silent) return null; throw new Error("no EVM wallet found. install MetaMask or Phantom."); }
  const eth = choice.provider;
  const generation = ++walletGeneration;
  signer = null; burnerWallet = null; inscribeCheckpoint = null; injected = eth;
  if (silent) {
    const accounts = await eth.request({ method: "eth_accounts" });
    if (generation !== walletGeneration) throw new Error(WALLET_CHANGED);
    if (!accounts.length || (await eth.request({ method: "eth_chainId" })).toLowerCase() !== CHAIN_ID) return null;
  } else {
    await eth.request({ method: "eth_requestAccounts" });
    if (generation !== walletGeneration) throw new Error(WALLET_CHANGED);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID }] });
    } catch (err) {
      if (err && (err.code === 4902 || /unrecognized|not added/i.test(String(err.message)))) {
        await eth.request({ method: "wallet_addEthereumChain", params: [{
          chainId: CHAIN_ID, chainName: "Robinhood Chain",
          rpcUrls: [DEFAULT_RPC], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        }] });
      } else throw err;
    }
  }
  if ((await eth.request({ method: "eth_chainId" })).toLowerCase() !== CHAIN_ID) throw new Error("switch the wallet to Robinhood Chain before connecting");
  const s = await new BrowserProvider(eth).getSigner();
  if (generation !== walletGeneration) throw new Error(WALLET_CHANGED);
  signer = s;
  disconnected = false;
  try { localStorage.setItem(WALLET_KEY, choice.id); } catch (e) {}
  return s.address;
}

export function disconnectEvm() {
  walletGeneration++;
  signer = null; injected = null; burnerWallet = null; inscribeCheckpoint = null; disconnected = true;
  try { localStorage.setItem(WALLET_KEY, "disconnected"); } catch (e) {}
}

// Read-only provider on the active RPC (a custom RPC is respected), for contract getters.
export const readProvider = () => new JsonRpcProvider(activeRpc);

// ── fees + estimate ─────────────────────────────────────────────────────────
// Contract fees cached for the sync estimator; refreshed once in background.
// Fallbacks are the mainnet values measured at feed setup.
const fees = { basic: 0.00012, linked: 0.00036 };
(async () => {
  try {
    const p = new JsonRpcProvider(DEFAULT_RPC);
    const [b, l] = await Promise.all([sdk.utils.getBasicFee(p), sdk.utils.getLinkedListFee(p)]);
    fees.basic = Number(formatEther(b)); fees.linked = Number(formatEther(l));
  } catch (e) { /* keep fallbacks */ }
})();

// writeRow tx count: <=700 B inline skips the chunk chain; larger batches 850
// char chunks under the SDK's 80KB payload budget, then dbCodeIn + tail = 2.
const BATCH_CHARS = 850 * 96;
const sigsFor = (len) => (len <= 700 ? 2 : Math.ceil(len / BATCH_CHARS) + 2);

// Board + inventory are charged separately, so the on-chain fee is 2x base.
export function estimateEvmCost(bytes) {
  const batches = Math.max(0, sigsFor(bytes) - 2);
  const fee = (bytes <= 700 ? fees.basic : fees.linked) * 2;
  return { sigs: 3, chunks: batches, totalLabel: fee.toFixed(5) + " ETH + gas" };
}

// ── burner ──────────────────────────────────────────────────────────────────
async function getBurner(session) {
  if (burnerWallet) return burnerWallet;
  const sig = await session.signer.signMessage(BURNER_MSG);
  if (session.generation !== walletGeneration) throw new Error(WALLET_CHANGED);
  burnerWallet = new Wallet(keccak256(toUtf8Bytes(sig)), new JsonRpcProvider(activeRpc));
  return burnerWallet;
}

async function writeSession(who) {
  if (!signer) throw new Error("connect the wallet first");
  const session = { signer, generation: walletGeneration };
  const accounts = await injected.request({ method: "eth_accounts" });
  const chain = await injected.request({ method: "eth_chainId" });
  if (session.generation !== walletGeneration || chain.toLowerCase() !== CHAIN_ID ||
      (accounts[0] || "").toLowerCase() !== session.signer.address.toLowerCase() || (who || "").toLowerCase() !== session.signer.address.toLowerCase())
    throw new Error(WALLET_CHANGED);
  return session;
}

// Top the burner up for the board fee + gas. A generous flat per-tx buffer is
// tiny in ETH and sweeps back; running the burner dry mid-upload is worse. NOT
// scaled up on retry (a resume needs less; have>=need tops up the shortfall).
async function fundBurner(burner, rowLen, session, onStatus) {
  const boardFeeEth = rowLen <= 700 ? fees.basic : fees.linked;
  const need = parseEther((boardFeeEth + 0.0005 * sigsFor(rowLen)).toFixed(9));
  const have = await burner.provider.getBalance(burner.address);
  if (have >= need) return;
  const topUp = need - have;
  const walletBal = await session.signer.provider.getBalance(session.signer.address);
  if (session.generation !== walletGeneration) throw new Error(WALLET_CHANGED);
  if (walletBal <= topUp) {
    throw new Error("not enough ETH in your wallet to start the write (need ~"
      + Number(formatEther(topUp)).toFixed(5) + " ETH, most of it comes back). add ETH and retry.");
  }
  onStatus && onStatus("funding - approve the transfer in your wallet");
  const tx = await session.signer.sendTransaction({ to: burner.address, value: topUp });
  onStatus && onStatus("funding - waiting for confirmation");
  await tx.wait();
}

// Best-effort leftover return; a deterministic burner means stranded dust is
// recoverable on the next run anyway.
async function sweepBurner(burner, to) {
  try {
    const bal = await burner.provider.getBalance(burner.address);
    const gp = (await burner.provider.getFeeData()).gasPrice || 100000000n;
    const cost = gp * 21000n * 2n;
    if (bal > cost) { const tx = await burner.sendTransaction({ to, value: bal - cost }); await tx.wait(); }
  } catch (e) { /* best-effort */ }
}

// ── writes ──────────────────────────────────────────────────────────────────
// Model B hybrid write (sdk writeRowWithInventory): the burner uploads chunks +
// writes the board row; the user signs only the 2 small inventory-finalize txs.
// On a stall the SDK throws with a phase checkpoint; keeping it keyed to the
// exact row lets a RETRY resume instead of redoing (and re-paying) everything.
export async function inscribeEvm({ kind, body, who, onProgress, onStatus }) {
  const row = JSON.stringify({ kind, body, who });
  const session = await writeSession(who);
  onStatus && onStatus("preparing - approve the wallet message if prompted");
  const burner = await getBurner(session);
  const resume = inscribeCheckpoint && inscribeCheckpoint.row === row ? inscribeCheckpoint.at : undefined;
  await fundBurner(burner, row.length, session, onStatus);
  if (session.generation !== walletGeneration) throw new Error(WALLET_CHANGED);
  let finalStep = resume && resume.inventoryTx ? 1 : 0;
  const finalizeSigner = new Proxy(session.signer, {
    get(target, key) {
      if (key === "sendTransaction") return async (...args) => {
        const step = ++finalStep;
        onStatus && onStatus("final signature " + step + "/2 - approve in your wallet");
        const tx = await target.sendTransaction(...args);
        onStatus && onStatus("final transaction " + step + "/2 - confirming");
        return tx;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const out = await sdk.writer.writeRowWithInventory(
      burner, finalizeSigner, DB_ROOT_ID, TABLE, row,
      { filename: kind, filetype: "text/plain", resume, onProgress: (pct) => onProgress && onProgress(Math.max(0, Math.min(100, Number(pct) || 0))) },
    );
    if (session.generation === walletGeneration) inscribeCheckpoint = null;
    sweepBurner(burner, session.signer.address); // fire-and-forget
    return { sig: out.boardTx };
  } catch (e) {
    if (session.generation === walletGeneration && e && e.checkpoint) inscribeCheckpoint = { row, at: e.checkpoint };
    throw e;
  }
}

// Board-only write via the user's wallet: a tiny inline row (the token launch
// registry). Small enough that its calldata never trips the wallet warning, so
// no burner and no inventory finalize.
export async function inscribeEvmBoard({ kind, body, who }) {
  const session = await writeSession(who);
  const row = JSON.stringify({ kind, body, who });
  const hash = await sdk.writer.writeRow(session.signer, DB_ROOT_ID, TABLE, row);
  return { sig: hash };
}

// ── reads (gateway; rows come back with __txHash, mirror to __txSignature) ──
const normRows = (rows) => (Array.isArray(rows) ? rows : []).map((r) => (
  r && r.row ? r.row : r
)).map((r) => (r && r.__txHash && !r.__txSignature ? Object.assign({ __txSignature: r.__txHash }, r) : r));

async function gwJson(path) {
  const res = await fetch(GATEWAY + path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("gateway " + res.status);
  return res.json();
}

export async function readEvmBoard(limit = 24, before) {
  const data = await gwJson("/table/" + DB_ROOT_ID + "/" + TABLE + "/rows?" + NET + "&limit=" + limit + (before ? "&before=" + before : ""));
  return { rows: normRows(data && data.rows), nextCursor: (data && data.nextCursor) || null };
}

// writeRow does not touch the per-user codeIn chain on EVM, so "mine" is the
// feed filtered by the who column, paged a few cursors deep.
export async function readEvmMine(addr, limit = 24) {
  const me = String(addr || "").toLowerCase();
  const out = []; let cursor = null;
  for (let i = 0; i < 5; i++) {
    const page = await readEvmBoard(50, cursor);
    out.push(...page.rows.filter((r) => String(r.who || "").toLowerCase() === me));
    cursor = page.nextCursor;
    if (!cursor || out.length >= limit) break;
  }
  return { rows: out.slice(0, limit) };
}

export async function readEvmTokens(want = 30, maxPages = 8) {
  const tokens = [];
  let before = null;
  for (let page = 0; page < maxPages && tokens.length < want; page++) {
    const { rows, nextCursor } = await readEvmBoard(60, before);
    for (const r of rows) {
      if (!r || r.kind !== "token") continue;
      try { const t = JSON.parse(r.body); if (t.mint && !tokens.some((x) => x.mint === t.mint)) tokens.push(t); } catch (e) {}
    }
    if (!nextCursor) break;
    before = nextCursor;
  }
  return tokens;
}

export const evmImgUrl = (hash) => GATEWAY + "/img/" + hash + ".png?" + NET;
export const evmRenderUrl = (hash) => GATEWAY + "/render/" + hash + "?" + NET;

// Warm the durable index after a landed write. Not just a cache hint on
// robinhood: without it the first read cold-walks the chain and a fresh post is
// invisible for minutes. The warm cold-walks too, so the timeout outlasts it.
export async function notifyEvm(hash, row) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(GATEWAY + "/table/" + DB_ROOT_ID + "/" + TABLE + "/notify?" + NET, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txSignature: hash, txHash: hash, row }), signal: ctrl.signal,
    });
    return res.ok;
  } catch (e) { return false; } finally { clearTimeout(t); }
}
