// Token-2022 primitives for stock-token payments: the associated token account
// of an owner, the two instructions a payment needs, and a balance read. Every
// currency the backend lists is a Token-2022 mint (its currencies.ts), so there
// is one token program here. Built by hand to keep the page free of a bundler.
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export const ataOf = (owner, mint) =>
  PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_2022.toBytes(), mint.toBytes()], ATA_PROGRAM)[0];

// CreateIdempotent: a no-op when the account already exists, so it is safe to
// prepend without checking first.
export const createAtaIx = (payer, owner, mint) =>
  new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ataOf(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  });

// TransferChecked between two owners' associated accounts, signed by `from`.
export function transferIx(from, to, mint, amount, decimals) {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: TOKEN_2022,
    keys: [
      { pubkey: ataOf(from, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: ataOf(to, mint), isSigner: false, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// The mint's own decimals. TransferChecked rejects any other value, so payments
// read it from chain instead of trusting a display list.
export const mintDecimals = async (connection, mint) => (await connection.getParsedAccountInfo(mint)).value.data.parsed.info.decimals;

// Raw units an owner holds; 0 when the account does not exist yet.
export async function tokenBalance(connection, owner, mint) {
  const info = await connection.getParsedAccountInfo(ataOf(owner, mint));
  return info.value ? Number(info.value.data.parsed.info.tokenAmount.amount) : 0;
}
