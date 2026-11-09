// Solana wallet layer: Wallet Standard discovery merged with the injected
// Phantom/solana providers, exposed as one adapter shape the rest of the site
// uses (publicKey, connect, signMessage, signTransaction, signAndSendTransaction).
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

const REMEMBER = "ic_wallet";
const registered = new Map();
let active = null;

// Wallet Standard handshake: wallets announce themselves on register-wallet
// and in response to app-ready.
const api = { register: (...wallets) => { for (const w of wallets) if (hasSolana(w)) registered.set("std:" + w.name, w); } };
window.addEventListener("wallet-standard:register-wallet", (e) => { try { e.detail(api); } catch (err) {} });
try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api })); } catch (e) {}

const hasSolana = (w) => w && w.features && (w.chains || []).some((c) => c.startsWith("solana:")) && w.features["standard:connect"];

function stdAdapter(w) {
  const feat = w.features;
  const adapter = {
    id: "std:" + w.name,
    name: w.name,
    icon: w.icon || null,
    publicKey: null,
    account: null,
    async connect(opts) {
      const r = await feat["standard:connect"].connect(opts && opts.silent ? { silent: true } : undefined);
      const acc = (r.accounts && r.accounts[0]) || w.accounts[0];
      if (!acc) throw new Error("the wallet returned no account");
      adapter.account = acc;
      adapter.publicKey = new PublicKey(acc.address);
      return adapter;
    },
    async signMessage(message) {
      const f = feat["solana:signMessage"];
      if (!f) throw new Error(w.name + " cannot sign messages");
      const [out] = await f.signMessage({ account: adapter.account, message });
      return out.signature;
    },
    async signTransaction(tx) {
      const f = feat["solana:signTransaction"];
      if (!f) throw new Error(w.name + " cannot sign transactions");
      const versioned = typeof tx.serializeMessage !== "function";
      const bytes = versioned ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [out] = await f.signTransaction({ account: adapter.account, transaction: bytes, chain: adapter.account.chains && adapter.account.chains[0] });
      return versioned ? VersionedTransaction.deserialize(out.signedTransaction) : Transaction.from(out.signedTransaction);
    },
    async signAndSendTransaction(tx) {
      const f = feat["solana:signAndSendTransaction"];
      if (f) {
        const [out] = await f.signAndSendTransaction({ account: adapter.account, transaction: tx.serialize(), chain: adapter.account.chains && adapter.account.chains[0] });
        const sig = out.signature; // bytes per the standard; some wallets return base58
        return { signature: typeof sig === "string" ? sig : bs58ish(sig) };
      }
      throw new Error(w.name + " cannot send transactions directly");
    },
    disconnect: () => feat["standard:disconnect"] ? feat["standard:disconnect"].disconnect().catch(() => {}) : Promise.resolve(),
  };
  return adapter;
}

// web3's PublicKey gives us base58 without pulling a codec in.
const bs58ish = (bytes) => { try { return new PublicKey(bytes).toBase58(); } catch (e) { return Array.from(bytes).join(","); } };

function injectedAdapter(provider, name) {
  return {
    id: "inj:" + name,
    name,
    icon: null,
    get publicKey() { return provider.publicKey; },
    async connect(opts) {
      await provider.connect(opts && opts.silent ? { onlyIfTrusted: true } : undefined);
      return this;
    },
    signMessage: async (message) => (await provider.signMessage(message)).signature,
    signTransaction: (tx) => provider.signTransaction(tx),
    signAndSendTransaction: (tx) => provider.signAndSendTransaction(tx),
    disconnect: () => (provider.disconnect ? provider.disconnect().catch(() => {}) : Promise.resolve()),
  };
}

export function wallets() {
  const out = [];
  const phantom = window.phantom && window.phantom.solana;
  if (phantom) out.push(injectedAdapter(phantom, "Phantom"));
  for (const w of registered.values()) {
    if (out.some((a) => a.name.toLowerCase() === w.name.toLowerCase())) continue;
    out.push(stdAdapter(w));
  }
  if (!out.length && window.solana) out.push(injectedAdapter(window.solana, "Solana wallet"));
  return out;
}

export async function connect(id) {
  const list = wallets();
  if (!list.length) throw new Error("no Solana wallet found. install Phantom, Solflare or any Wallet Standard wallet.");
  const pick = id ? list.find((w) => w.id === id) : list[0];
  if (!pick) throw new Error("that wallet is no longer available");
  active = await pick.connect();
  try { localStorage.setItem(REMEMBER, active.id); } catch (e) {}
  return active;
}

// Silent reconnect of the previously approved wallet; null when none sticks.
export async function restore() {
  let id = null;
  try { id = localStorage.getItem(REMEMBER); } catch (e) {}
  if (!id) return null;
  const pick = wallets().find((w) => w.id === id);
  if (!pick) return null;
  try { active = await pick.connect({ silent: true }); return active; } catch (e) { return null; }
}

export function current() { return active && active.publicKey ? active : null; }

export async function disconnect() {
  if (active) await active.disconnect();
  active = null;
  try { localStorage.removeItem(REMEMBER); } catch (e) {}
}
