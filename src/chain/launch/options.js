export const PUMP_FEE_SOL = 0.069;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Curated shortcuts. The launch adapters verify the exact mint or contract
// against the venue at launch; pasted addresses use the same checks.
export const PAIRS = {
  solana: [
    ["SOL", ""],
    ["USDC", USDC_MINT],
    ["NVIDIA · NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"],
    ["Tesla · TSLAx", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"],
    ["S&P 500 · SPYx", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"],
    ["Apple · AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"],
  ],
  hood: [
    ["ETH", ""],
    ["USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
    ["NVIDIA · NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
    ["Tesla · TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
    ["S&P 500 · SPY", "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"],
    ["Apple · AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
  ],
};
