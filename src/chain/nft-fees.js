// Keep this in sync with the NFT registry program's PLATFORM_FEE_BPS.
export const PLATFORM_FEE_BPS = 500;
export const mintPlatformFee = (price) => Math.floor((price * PLATFORM_FEE_BPS) / 10_000);
