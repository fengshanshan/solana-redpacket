import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Redpacket } from "../target/types/redpacket";
import {
  confirmTransaction,
  createAccountsMintsAndTokenAccounts,
} from "@solana-developers/helpers";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

// Work on both Token Program and new Token Extensions Program
const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID =
  TOKEN_2022_PROGRAM_ID;

const SECONDS = 1000;

describe("redpacket", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const signer = (provider.wallet as anchor.Wallet).payer;
  const randomUser = anchor.web3.Keypair.generate();

  let redPacketCreator: anchor.web3.Keypair;

  // We're going to reuse these accounts across multiple tests
  const nativeAccounts: Record<string, PublicKey> = {
    systemProgram: anchor.web3.SystemProgram.programId,
  };
  const splTokenAccounts: Record<string, PublicKey> = {
    tokenProgram: TOKEN_PROGRAM,
  };

  const redPacketProgram = anchor.workspace.Redpacket as Program<Redpacket>;

  // Add beforeAll if you need any setup before all tests
  before(async () => {
    // Create users and mints
    const usersMintsAndTokenAccounts =
      await createAccountsMintsAndTokenAccounts(
        [[100]],
        1 * LAMPORTS_PER_SOL,
        connection,
        signer
      );

    const tokenAccounts = usersMintsAndTokenAccounts.tokenAccounts;
    const tokenMint = usersMintsAndTokenAccounts.mints[0];

    splTokenAccounts.tokenMint = tokenMint.publicKey;
    splTokenAccounts.tokenAccount = tokenAccounts[0][0];

    const users = usersMintsAndTokenAccounts.users;
    redPacketCreator = users[0];

    splTokenAccounts.creator = redPacketCreator.publicKey;
    //nativeAccounts.creator = redPacketCreator.publicKey;
  });

  it("create SPL token redpacket", async () => {
    // Create red packet
    const redPacketId = new anchor.BN(1);

    const redPacket = PublicKey.findProgramAddressSync(
      [redPacketId.toArrayLike(Buffer, "le", 8)],
      redPacketProgram.programId
    )[0];
    splTokenAccounts.redPacket = redPacket;

    // 为 vault 创建相关的 PDA
    const vault = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      redPacket,
      true,
      TOKEN_PROGRAM
    );
    splTokenAccounts.vault = vault;

    const redPacketExpiry = new anchor.BN(Date.now() + 1000 * 60 * 60 * 24);
    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(3);

    const tx = await redPacketProgram.methods
      .createRedPacket(
        redPacketId,
        redPacketTotalNumber,
        redPacketTotalAmount,
        redPacketExpiry,
        1, // token_type (0 for SOL, 1 for SPL token)
        false // if_split_random
      )
      .accounts({ ...splTokenAccounts })
      .signers([redPacketCreator])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Fetch and verify the created red packet account
    // Check vault contains the tokens offered
    const vaultBalanceResponse = await connection.getTokenAccountBalance(vault);
    const vaultBalance = new anchor.BN(vaultBalanceResponse.value.amount);
    console.log("vaultBalance", vaultBalance.toString());

    // After creating red packet
    const creatorTokenBalanceAfter = await connection.getTokenAccountBalance(
      splTokenAccounts.tokenAccount
    );
    expect(vaultBalance.toString()).equal("3");
    expect(creatorTokenBalanceAfter.value.amount).equal("97");

    // Check red packet
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );
    expect(redPacketAccount.totalNumber.toString()).equal(
      redPacketTotalNumber.toString()
    );
    expect(redPacketAccount.totalAmount.toString()).equal(
      redPacketTotalAmount.toString()
    );
    expect(redPacketAccount.expiry.toString()).equal(
      redPacketExpiry.toString()
    );
    expect(redPacketAccount.tokenType).equal(1);
    expect(redPacketAccount.ifSpiltRandom).equal(false);
    expect(redPacketAccount.claimedNumber.toString()).equal("0");
    expect(redPacketAccount.claimedAmount.toString()).equal("0");
    expect(redPacketAccount.creator.toString()).equal(
      redPacketCreator.publicKey.toString()
    );
  });

  it("create native token redpacket", async () => {
    // Airdrop some SOL to redPacketCreator
    const airdropSignature = await connection.requestAirdrop(
      redPacketCreator.publicKey,
      3 * LAMPORTS_PER_SOL // This will airdrop 3 SOL
    );
    await confirmTransaction(connection, airdropSignature);
    // Create red packet
    const redPacketId = new anchor.BN(2);

    const redPacket = PublicKey.findProgramAddressSync(
      [redPacketId.toArrayLike(Buffer, "le", 8)],
      redPacketProgram.programId
    )[0];

    nativeAccounts.creator = redPacketCreator.publicKey;
    nativeAccounts.redPacket = redPacket;

    nativeAccounts.tokenProgram = TOKEN_PROGRAM;
    nativeAccounts.tokenAccount = splTokenAccounts.tokenAccount;
    nativeAccounts.tokenMint = splTokenAccounts.tokenMint;

    // // 为 vault 创建相关的 PDA
    const vault = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      redPacket,
      true,
      TOKEN_PROGRAM
    );
    nativeAccounts.vault = vault;

    const redPacketExpiry = new anchor.BN(Date.now() + 1000 * 60 * 60 * 24);
    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);
    const tx = await redPacketProgram.methods
      .createRedPacket(
        redPacketId,
        redPacketTotalNumber,
        redPacketTotalAmount,
        redPacketExpiry,
        0, // token_type (0 for SOL, 1 for SPL token)
        false // if_split_random
      )
      .accounts({ ...nativeAccounts })
      .signers([redPacketCreator])
      .rpc();
    await provider.connection.confirmTransaction(tx);
    // Fetch and verify the created red packet account

    // Check red packet
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );
    expect(redPacketAccount.totalNumber.toString()).equal(
      redPacketTotalNumber.toString()
    );
    expect(redPacketAccount.totalAmount.toString()).equal(
      redPacketTotalAmount.toString()
    );
    expect(redPacketAccount.expiry.toString()).equal(
      redPacketExpiry.toString()
    );
    expect(redPacketAccount.tokenType).equal(0);
    expect(redPacketAccount.ifSpiltRandom).equal(false);
    expect(redPacketAccount.claimedNumber.toString()).equal("0");
    expect(redPacketAccount.claimedAmount.toString()).equal("0");
    expect(redPacketAccount.creator.toString()).equal(
      redPacketCreator.publicKey.toString()
    );
  });

  it.skip("claim red packet successfully", async () => {
    // First create a red packet
    const redPacketId = new anchor.BN(1);

    const redPacket = PublicKey.findProgramAddressSync(
      [redPacketId.toArrayLike(Buffer, "le", 8)],
      redPacketProgram.programId
    )[0];
    nativeAccounts.redPacket = redPacket;

    await redPacketProgram.methods
      .claim(redPacketId)
      .accounts({ ...nativeAccounts })
      .signers([randomUser])
      .rpc();

    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );
    expect(redPacketAccount.claimedNumber.toString()).equal("1");
    expect(redPacketAccount.claimedAmount.toString()).equal("1");
  });

  it.skip("withdraw red packet failed because red packet is not expired", async () => {
    // First create a red packe
  });
});
