// Pons V2 launcher (Robinhood Chain). No portal exists, so the launchToken call
// is built directly against the factory and the connected wallet signs it; the
// wallet's address is the recorded deployer, so the launching user owns the coin.
//
// Verified on-chain (factory 0x7ed5...ec7e, chainId 4663): launchFee 0.0005 ETH,
// maxCreatorTaxBps 1000, a single enabled launch config.
import { Contract, ZeroAddress, ZeroHash, randomBytes, hexlify, getAddress, formatEther, parseUnits } from "ethers";

export const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";

// Only the surface this module calls. The 4-arg launchToken overload (selector
// 0xa72101af) is the one Pons' own UI uses, and the only form whose calldata
// their indexer decodes `description` from; the trailing address[] is an
// extra-recipients list, empty is valid.
export const LAUNCH_AND_BUY = "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948";
const TOKEN_PARAMS = "(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)";
const ROUTER_ABI = [
  `function launchAndBuy(${TOKEN_PARAMS} params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)`,
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const ABI = [
  "function canLaunch(address) view returns (bool)",
  "function maxCreatorTaxBps() view returns (uint16)",
  "function approvedPairTokens(address) view returns (bool)",
  "function pairTokenEconomics(address) view returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)",
  "function previewLaunchEconomics(uint256, address) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))",
  `function launchToken(${TOKEN_PARAMS} params, uint256 launchConfigId, address pairToken, address[] extraRecipients) payable returns (address token, address curve)`,
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

// Default to the first enabled configuration; explicit selections must also be enabled.
async function resolveLaunchConfigId(factory, selection) {
  const count = Number(await factory.launchConfigCount());
  if (selection !== "" && selection !== undefined) {
    const id = Number(selection);
    if (!Number.isSafeInteger(id) || id < 0 || id >= count || !(await factory.getLaunchConfig(id)).enabled) {
      throw new Error("That Pons launch configuration is not enabled.");
    }
    return id;
  }
  for (let i = 0; i < count; i++) {
    if ((await factory.getLaunchConfig(i)).enabled) return i;
  }
  throw new Error("no enabled Pons launch config on chain");
}

export async function launchOnPons({ signer, name, symbol, logo, description, socials, options, onStep }) {
  if (!signer) throw new Error("Connect a Robinhood Chain wallet first.");
  if ((await signer.provider.getNetwork()).chainId !== 4663n) throw new Error("Switch your wallet to Robinhood Chain.");
  const factory = new Contract(FACTORY, ABI, signer);
  const user = await signer.getAddress();
  const pairToken = options.pair ? getAddress(options.pair) : ZeroAddress;
  const creatorFeeRecipient = options.recipient ? getAddress(options.recipient.trim()) : user;
  const creatorTaxBps = Number(options.creatorFee || "0");
  const exemptions = [...new Set(options.exemptions.split(/[\s,]+/).filter(Boolean).map(getAddress))];
  if (exemptions.length > 32 || exemptions.includes(ZeroAddress)) throw new Error("Enter up to 32 valid exemption wallets.");

  onStep("checking Pons launch terms");
  const [launchConfigId, launchFee, allowed, taxCap] = await Promise.all([
    resolveLaunchConfigId(factory, options.configId), factory.launchFee(), factory.canLaunch(user), factory.maxCreatorTaxBps(),
  ]);
  if (!allowed) throw new Error("Pons is not accepting launches from this wallet.");
  if (!Number.isSafeInteger(creatorTaxBps) || creatorTaxBps < 0 || creatorTaxBps > Number(taxCap)) {
    throw new Error("Creator tax must be between 0 and " + taxCap + " basis points.");
  }
  let quoteDecimals = 18;
  if (pairToken !== ZeroAddress) {
    const [approved, terms] = await Promise.all([factory.approvedPairTokens(pairToken), factory.pairTokenEconomics(pairToken)]);
    if (!approved || !terms.phantomQuote || !terms.graduationThreshold) throw new Error("Pons has not enabled this quote asset.");
    quoteDecimals = Number(terms.decimals);
  }
  const expectedEconomics = await factory.previewLaunchEconomics(launchConfigId, pairToken);
  if (expectedEconomics === ZeroHash) throw new Error("Pons did not return launch terms.");

  const params = {
    name, symbol, logo, description, socials, creatorFeeRecipient, creatorTaxBps,
    buybackEnabled: Boolean(options.buyback), expectedEconomics, salt: hexlify(randomBytes(32)),
  };
  const quoteIn = parseUnits(options.initialBuy || "0", quoteDecimals);
  if (quoteIn < 0n) throw new Error("Enter a non-negative opening buy.");
  let send = factory.launchToken;
  let args = [params, launchConfigId, pairToken, exemptions, { value: launchFee }];
  if (quoteIn > 0n) {
    const minTokensOut = parseUnits(options.minTokensOut || "0", 18);
    if (minTokensOut <= 0n) throw new Error("Set a positive minimum number of coins to receive.");
    if (creatorFeeRecipient === ZeroAddress) throw new Error("Set a creator fee wallet for an opening buy.");
    const router = new Contract(LAUNCH_AND_BUY, ROUTER_ABI, signer);
    send = router.launchAndBuy;
    const stockPair = pairToken !== ZeroAddress;
    args = [params, launchConfigId, pairToken, quoteIn, minTokensOut, user, exemptions, {
      value: stockPair ? launchFee : launchFee + quoteIn,
    }];
    if (stockPair) {
      const quote = new Contract(pairToken, ERC20_ABI, signer);
      const [balance, allowance] = await Promise.all([quote.balanceOf(user), quote.allowance(user, LAUNCH_AND_BUY)]);
      if (balance < quoteIn) throw new Error("Your wallet does not have enough of the quote asset.");
      if (allowance < quoteIn) {
        if (!(await quote.approve.staticCall(LAUNCH_AND_BUY, quoteIn))) throw new Error("The quote asset refused the approval.");
        onStep("approve only the opening buy amount for Pons");
        const approval = await quote.approve(LAUNCH_AND_BUY, quoteIn);
        try { await approval.wait(1, 120_000); }
        catch (error) { throw new Error("Check approval " + approval.hash + " before retrying: " + error.message); }
        if (await quote.allowance(user, LAUNCH_AND_BUY) < quoteIn) throw new Error("The opening-buy allowance did not update.");
      }
    }
  }
  await send.staticCall(...args);
  onStep("approve " + formatEther(args.at(-1).value) + " ETH plus gas");
  const tx = await send(...args);

  onStep("confirming on robinhood chain");
  let receipt;
  try { receipt = await tx.wait(1, 120_000); }
  catch (error) { throw new Error("Check transaction " + tx.hash + " before retrying: " + error.message); }

  // launchToken's return values are not visible to an EOA tx; read the token
  // address from the TokenLaunched log.
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
    const parsed = factory.interface.parseLog(log);
    if (parsed?.name === "TokenLaunched") {
      if (getAddress(parsed.args.pairToken) !== pairToken) throw new Error("Pons confirmed a different quote asset; check transaction " + tx.hash);
      return { token: parsed.args.token, txHash: receipt.hash };
    }
  }
  throw new Error("launch landed but no TokenLaunched event was found: " + receipt.hash);
}
