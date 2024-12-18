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
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const redPacketProgram = anchor.workspace.Redpacket as Program<Redpacket>;

  // First create red packets
  const splTokenRedPacketID = new anchor.BN(1);
  const splTokenRedPacket = PublicKey.findProgramAddressSync(
    [splTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
    redPacketProgram.programId
  )[0];

  const nativeTokenRedPacketID = new anchor.BN(2);
  const nativeTokenRedPacket = PublicKey.findProgramAddressSync(
    [nativeTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
    redPacketProgram.programId
  )[0];

  const shortTimeSPLTokenRedPacketID = new anchor.BN(3);
  const shortTimeSPLTokenRedPacket = PublicKey.findProgramAddressSync(
    [shortTimeSPLTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
    redPacketProgram.programId
  )[0];

  const shortTimeNativeTokenRedPacketID = new anchor.BN(4);
  const shortTimeNativeTokenRedPacket = PublicKey.findProgramAddressSync(
    [shortTimeNativeTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
    redPacketProgram.programId
  )[0];

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

    splTokenAccounts.signer = redPacketCreator.publicKey;
    nativeAccounts.signer = redPacketCreator.publicKey;
  });

  it("create SPL token redpacket", async () => {
    // Airdrop some SOL to redPacketCreator
    const airdropSignature = await connection.requestAirdrop(
      redPacketCreator.publicKey,
      1 * LAMPORTS_PER_SOL // This will airdrop 1 SOL
    );
    await confirmTransaction(connection, airdropSignature);

    splTokenAccounts.redPacket = splTokenRedPacket;

    // 为 vault 创建相关的 PDA
    const vault = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      splTokenRedPacket,
      true,
      TOKEN_PROGRAM
    );
    splTokenAccounts.vault = vault;

    const redPacketExpiry = new anchor.BN(Date.now() + 1000 * 60 * 60 * 24);
    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(3);

    try {
      const tx = await redPacketProgram.methods
        .createRedPacketWithSplToken(
          splTokenRedPacketID,
          redPacketTotalNumber,
          redPacketTotalAmount,
          redPacketExpiry,
          false // if_split_random
        )
        .accounts({
          ...splTokenAccounts,
        })
        .signers([redPacketCreator])
        .rpc();

      await provider.connection.confirmTransaction(tx);
    } catch (error) {
      console.error("Transaction failed:", error);
      if (error.logs) {
        console.log("Transaction logs:", error.logs);
      }
      await getLogs(error.signature);
    }

    // Fetch and verify the created red packet account
    // Check vault contains the tokens offered
    const vaultBalanceResponse = await connection.getTokenAccountBalance(vault);
    const vaultBalance = new anchor.BN(vaultBalanceResponse.value.amount);

    const creatorBalanceResponse = await connection.getTokenAccountBalance(
      splTokenAccounts.vault
    );
    const creatorBalance = new anchor.BN(creatorBalanceResponse.value.amount);
    console.log("creatorBalance", creatorBalance.toString());

    // After creating red packet
    const creatorTokenBalanceAfter = await connection.getTokenAccountBalance(
      splTokenAccounts.tokenAccount
    );
    expect(vaultBalance.toString()).equal("3");
    expect(creatorTokenBalanceAfter.value.amount).equal("97");

    // Check red packet
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      splTokenAccounts.redPacket
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
      4 * LAMPORTS_PER_SOL // This will airdrop 3 SOL
    );
    await confirmTransaction(connection, airdropSignature);

    nativeAccounts.redPacket = nativeTokenRedPacket;

    const redPacketExpiry = new anchor.BN(Date.now() + 1000 * 60 * 60 * 24);
    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);
    const tx = await redPacketProgram.methods
      .createRedPacketWithNativeToken(
        nativeTokenRedPacketID,
        redPacketTotalNumber,
        redPacketTotalAmount,
        redPacketExpiry,
        false // if_split_random
      )
      .accounts({ ...nativeAccounts })
      .signers([redPacketCreator])
      .rpc();
    await provider.connection.confirmTransaction(tx);
    // Fetch and verify the created red packet account

    //Check red packet
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      nativeTokenRedPacket
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

  it("claim spl token red packet", async () => {
    const claimerTokenAccount = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      randomUser.publicKey,
      true,
      TOKEN_PROGRAM
    );

    // Airdrop some SOL to redPacketCreator
    const airdropSignature = await connection.requestAirdrop(
      randomUser.publicKey,
      1 * LAMPORTS_PER_SOL // This will airdrop 1 SOL, pay for initialize the claimer token account
    );
    await confirmTransaction(connection, airdropSignature);

    const tx = await redPacketProgram.methods
      .claimWithSplToken(splTokenRedPacketID)
      .accounts({
        redPacket: splTokenRedPacket,
        signer: randomUser.publicKey,
        vault: splTokenAccounts.vault,
        tokenAccount: claimerTokenAccount, // Will be created if it doesn't exist
        tokenMint: splTokenAccounts.tokenMint,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([randomUser])
      .rpc();
    await provider.connection.confirmTransaction(tx);

    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      splTokenRedPacket
    );
    expect(redPacketAccount.claimedNumber.toString()).equal("1");
    expect(redPacketAccount.claimedAmount.toString()).equal("1");
    expect(redPacketAccount.claimedUsers.length).equal(1);
    expect(redPacketAccount.claimedUsers[0].toString()).equal(
      randomUser.publicKey.toString()
    );
  });

  it("claim native token red packet", async () => {
    // Airdrop some SOL to redPacketCreator
    const airdropSignature = await connection.requestAirdrop(
      randomUser.publicKey,
      1 * LAMPORTS_PER_SOL // This will airdrop 1 SOL, pay for initialize the claimer token account
    );
    await confirmTransaction(connection, airdropSignature);

    const tx = await redPacketProgram.methods
      .claimWithNativeToken(nativeTokenRedPacketID)
      .accounts({
        redPacket: nativeTokenRedPacket,
        signer: randomUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([randomUser])
      .rpc();
    await provider.connection.confirmTransaction(tx);

    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      nativeTokenRedPacket
    );

    expect(redPacketAccount.claimedNumber.toString()).equal("1");
    expect(redPacketAccount.claimedAmount.toString()).equal(
      (1 * LAMPORTS_PER_SOL).toString()
    );
    expect(redPacketAccount.claimedUsers.length).equal(1);
    expect(redPacketAccount.claimedUsers[0].toString()).equal(
      randomUser.publicKey.toString()
    );
  });

  it("withdraw spl token red packet", async () => {
    // Create red packet with very short expiry (2 seconds)
    // 为 vault 创建相关的 PDA
    const creatorVault = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      redPacketCreator.publicKey,
      true,
      TOKEN_PROGRAM
    );
    const creatorBalanceResponse = await connection.getTokenAccountBalance(
      creatorVault
    );
    const creatorBalance = new anchor.BN(creatorBalanceResponse.value.amount);
    console.log("creatorBalance", creatorBalance.toString());

    // Create the red packet first
    splTokenAccounts.redPacket = shortTimeSPLTokenRedPacket;

    const vault = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      shortTimeSPLTokenRedPacket,
      true,
      TOKEN_PROGRAM
    );
    splTokenAccounts.vault = vault;

    const expiry = new anchor.BN(Date.now() + 2 * SECONDS);
    const totalNumber = new anchor.BN(3);
    const totalAmount = new anchor.BN(3);

    const tx = await redPacketProgram.methods
      .createRedPacketWithSplToken(
        shortTimeSPLTokenRedPacketID,
        totalNumber,
        totalAmount,
        expiry,
        false
      )
      .accounts({
        ...splTokenAccounts,
      })
      .signers([redPacketCreator])
      .rpc();
    await provider.connection.confirmTransaction(tx);
    //console.log(tx);

    // Print the logs
    await getLogs(tx);

    // Wait for the red packet to expire
    console.log("Waiting for red packet to expire...");
    console.log("Now time is: ", Date.now());
    await delay(6 * SECONDS);
    console.log("Wait complete, proceeding with withdrawal...", Date.now());
    console.log("After wait, Now time is: ", Date.now().toString());

    const signerTokenAccount = getAssociatedTokenAddressSync(
      splTokenAccounts.tokenMint,
      redPacketCreator.publicKey,
      true,
      TOKEN_PROGRAM
    );
    // Now perform withdrawal
    const withdrawTx = await redPacketProgram.methods
      .withdrawWithSplToken(shortTimeSPLTokenRedPacketID)
      .accounts({
        redPacket: shortTimeSPLTokenRedPacket,
        signer: redPacketCreator.publicKey,
        vault: splTokenAccounts.vault,
        tokenAccount: signerTokenAccount, // Will be created if it doesn't exist
        tokenMint: splTokenAccounts.tokenMint,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([redPacketCreator])
      .rpc();

    await provider.connection.confirmTransaction(withdrawTx);
    console.log(withdrawTx);

    const creatorBalanceBefore = await connection.getBalance(
      redPacketCreator.publicKey
    );
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      shortTimeSPLTokenRedPacket
    );
    expect(redPacketAccount.withdrawStatus).equal(1);
  });

  it("withdraw native token red packet", async () => {
    const airdropSignature = await connection.requestAirdrop(
      redPacketCreator.publicKey,
      4 * LAMPORTS_PER_SOL // This will airdrop 4 SOL
    );
    await confirmTransaction(connection, airdropSignature);

    const redPacketExpiry = new anchor.BN(Date.now() + 2 * SECONDS);
    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);
    const tx = await redPacketProgram.methods
      .createRedPacketWithNativeToken(
        shortTimeNativeTokenRedPacketID,
        redPacketTotalNumber,
        redPacketTotalAmount,
        redPacketExpiry,
        false // if_split_random
      )
      .accounts({
        signer: redPacketCreator.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        redPacket: shortTimeNativeTokenRedPacket,
      })
      .signers([redPacketCreator])
      .rpc();
    await provider.connection.confirmTransaction(tx);
    // Fetch and verify the created red packet account

    let redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      shortTimeNativeTokenRedPacket
    );
    expect(redPacketAccount.withdrawStatus).equal(0);

    // Wait for the red packet to expire
    console.log("Waiting for red packet to expire...");
    console.log("Now time is: ", Date.now() / 1000);
    await delay(10 * SECONDS);
    console.log(
      "Wait complete, proceeding with withdrawal...",
      Date.now() / 1000
    );
    console.log("After wait, Now time is: ", Date.now() / 1000);

    const creatorTokenBalanceBefore = await connection.getBalance(
      redPacketCreator.publicKey
    );
    console.log("creatorTokenBalanceBefore", creatorTokenBalanceBefore);
    // Now perform withdrawal
    const withdrawTx = await redPacketProgram.methods
      .withdrawWithNativeToken(shortTimeNativeTokenRedPacketID)
      .accounts({
        redPacket: shortTimeNativeTokenRedPacket,
        signer: redPacketCreator.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([redPacketCreator])
      .rpc();

    await provider.connection.confirmTransaction(withdrawTx);
    console.log("withdrawTx", withdrawTx);
    await getLogs(withdrawTx);

    //Check red packet
    redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      shortTimeNativeTokenRedPacket
    );
    expect(redPacketAccount.withdrawStatus).equal(1);
    const creatorBalanceAfter = await connection.getBalance(
      redPacketCreator.publicKey
    );
    console.log("creatorBalanceAfter", creatorBalanceAfter);
  });
});

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLogs(signature: string) {
  try {
    const provider = anchor.AnchorProvider.env();
    const logs = await provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!logs || !logs.meta) {
      console.error("Failed to retrieve logs for transaction:", signature);
      return;
    }
    console.log("Program Logs:");
    console.log(logs.meta.logMessages.join("\n"));
  } catch (error) {
    console.error("Error retrieving logs for transaction:", signature, error);
  }
}
