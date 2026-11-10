// Pons V2 launcher (Robinhood Chain). No portal exists, so the launchToken call
// is built directly against the factory and the connected wallet signs it; the
// wallet's address is the recorded deployer, so the launching user owns the coin.
//
// Verified on-chain (factory 0x7ed5...ec7e, chainId 4663): launchFee 0.0005 ETH,
// maxCreatorTaxBps 1000, a single enabled launch config.
import { Contract, ZeroAddress, ZeroHash, randomBytes, hexlify } from "ethers";

export const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";

// Only the surface this module calls. The 4-arg launchToken overload (selector
// 0xa72101af) is the one Pons' own UI uses, and the only form whose calldata
// their indexer decodes `description` from; the trailing address[] is an
// extra-recipients list, empty is valid.
const ABI = [
  "function launchFee() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))",
  "function launchToken((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt) params, uint256 launchConfigId, address pairToken, address[] extraRecipients) payable returns (address token, address curve)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
];

// What a launched Pons token records about itself, verified live on chain.
const TOKEN_ABI = [
  "function description() view returns (string)",
  "function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)",
];

// The description + socials the token itself holds; provider = any read RPC.
export async function readPonsToken(provider, address) {
  const t = new Contract(address, TOKEN_ABI, provider);
  const [description, s] = await Promise.all([t.description(), t.socials()]);
  return { description, twitter: s.twitter, telegram: s.telegram, discord: s.discord, website: s.website, farcaster: s.farcaster };
}

// Pons renders a coin's description only when it is <=256 chars AND carries no
// url (measured), so strip urls and cap; recovery pointers ride the fields.
export const PONS_DESC_MAX = 256;
export const stripUrls = (s) => String(s || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();

// The factory rejects a disabled launchConfigId, so pick the lowest enabled one.
async function resolveLaunchConfigId(factory) {
  const count = Number(await factory.launchConfigCount());
  for (let i = 0; i < count; i++) {
    if ((await factory.getLaunchConfig(i)).enabled) return i;
  }
  throw new Error("no enabled Pons launch config on chain");
}

// Returns { token, txHash }. onStep(label) matches the pump launcher's shape.
export async function launchOnPons({ signer, name, symbol, logo, description, socials = {}, creatorTaxBps = 0, creatorFeeRecipient, buybackEnabled = false, onStep = () => {} }) {
  if (!signer) throw new Error("connect the wallet first");
  if (!name || !symbol) throw new Error("name and symbol are required");
  if (creatorTaxBps > 1000) throw new Error("creator tax cannot exceed 10% (1000 bps)");

  const factory = new Contract(FACTORY, ABI, signer);

  onStep("reading launch terms from chain");
  const [launchConfigId, launchFee] = await Promise.all([resolveLaunchConfigId(factory), factory.launchFee()]);

  const params = {
    name, symbol,
    logo: logo || "",
    description: description || "",
    socials: {
      twitter: socials.twitter || "", telegram: socials.telegram || "", discord: socials.discord || "",
      website: socials.website || "", farcaster: socials.farcaster || "",
    },
    creatorFeeRecipient: creatorFeeRecipient || (await signer.getAddress()),
    creatorTaxBps,
    buybackEnabled: !!buybackEnabled,
    // Zero waives the economics guard: the launch is sent in the same flow that
    // reads the terms, and the sole config's shape is fixed.
    expectedEconomics: ZeroHash,
    // Namespaced per deployer; a fresh random value is unique among this
    // wallet's launches (collision on identical terms would revert).
    salt: hexlify(randomBytes(32)),
  };

  onStep("approve the transaction in your wallet");
  const tx = await factory.launchToken(params, launchConfigId, ZeroAddress, [], { value: launchFee });

  onStep("confirming on robinhood chain");
  const receipt = await tx.wait();

  // launchToken's return values are not visible to an EOA tx; read the token
  // address from the TokenLaunched log.
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
    const parsed = factory.interface.parseLog(log);
    if (parsed && parsed.name === "TokenLaunched") return { token: parsed.args.token, txHash: receipt.hash };
  }
  throw new Error("launch landed but no TokenLaunched event was found: " + receipt.hash);
}
