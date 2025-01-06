import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Redpacket } from "../target/types/redpacket";
import {
  confirmTransaction,
  createAccountsMintsAndTokenAccounts,
  getKeypairFromEnvironment,
} from "@solana-developers/helpers";
import {
  Ed25519Program,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Keypair,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import "dotenv/config";

import nacl from "tweetnacl";
import bs58 from "bs58";

// Work on both Token Program and new Token Extensions Program
const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID =
  TOKEN_2022_PROGRAM_ID;

const SECONDS = 1000;

const claimer_issuer = getKeypairFromEnvironment("CLAIMER_ISSUER_SECRET_KEY");
const randomUser = getKeypairFromEnvironment("RANDOM_KEY_1");
const randomUser2 = getKeypairFromEnvironment("RANDOM_KEY_2");

describe("redpacket", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const signer = (provider.wallet as anchor.Wallet).payer;
  // const randomUser = anchor.web3.Keypair.generate();
  // const randomUser2 = anchor.web3.Keypair.generate();

  let redPacketCreator: anchor.web3.Keypair;
  let splTokenRedPacket: PublicKey;
  let nativeTokenRedPacket: PublicKey;
  let splRedPacketCreateTime: anchor.BN;
  let nativeRedPacketCreateTime: anchor.BN;
  let vault: PublicKey;
  let tokenMint: PublicKey;
  let tokenAccount: PublicKey;

  const redPacketProgram = anchor.workspace.Redpacket as Program<Redpacket>;

  // Add beforeAll if you need any setup before all tests
  before(async () => {
    const isLocalnet =
      provider.connection.rpcEndpoint.includes("localhost") ||
      provider.connection.rpcEndpoint.includes("127.0.0.1");
    console.log("RPC endpoint:", provider.connection.rpcEndpoint);
    console.log("isLocalnet:", isLocalnet);

    if (isLocalnet) {
      // Create users and mints
      const usersMintsAndTokenAccounts =
        await createAccountsMintsAndTokenAccounts(
          [[100 * LAMPORTS_PER_SOL]],
          1 * LAMPORTS_PER_SOL,
          connection,
          signer
        );

      const tokenAccounts = usersMintsAndTokenAccounts.tokenAccounts;
      const mints = usersMintsAndTokenAccounts.mints[0];

      tokenMint = mints.publicKey;
      tokenAccount = tokenAccounts[0][0];

      const users = usersMintsAndTokenAccounts.users;
      redPacketCreator = users[0];

      // Airdrop some SOL to redPacketCreator
      const airdropSignature = await connection.requestAirdrop(
        redPacketCreator.publicKey,
        5 * LAMPORTS_PER_SOL // This will airdrop 1 SOL
      );
      await confirmTransaction(connection, airdropSignature);

      // Airdrop some SOL to claimer
      const airdropSignatureClaimer = await connection.requestAirdrop(
        randomUser.publicKey,
        1 * LAMPORTS_PER_SOL // This will airdrop 1 SOL, pay for initialize the claimer token account
      );
      await confirmTransaction(connection, airdropSignatureClaimer);

      // Airdrop some SOL to claimer
      const airdropSignatureClaimer2 = await connection.requestAirdrop(
        randomUser2.publicKey,
        1 * LAMPORTS_PER_SOL // This will airdrop 1 SOL, pay for initialize the claimer token account
      );
      await confirmTransaction(connection, airdropSignatureClaimer2);
    } else {
      redPacketCreator = getKeypairFromEnvironment("CREATOR");
      // Create mint
      tokenMint = await createMint(
        connection,
        signer, // payer
        redPacketCreator.publicKey, // mintAuthority
        null, // freezeAuthority (you can use null)
        9, // decimals
        undefined,
        undefined,
        TOKEN_PROGRAM
      );
      // Create token account for redPacketCreator
      const tokenAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        signer,
        tokenMint,
        redPacketCreator.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM
      );
      tokenAccount = tokenAccountInfo.address;

      // // Mint some tokens to redPacketCreator's token account
      await mintTo(
        connection,
        redPacketCreator,
        tokenMint,
        tokenAccount,
        redPacketCreator, // mint authority
        100 * LAMPORTS_PER_SOL, // amount
        [],
        undefined,
        TOKEN_PROGRAM
      );

      console.log("Setup complete:");
      console.log("Token Mint:", tokenMint.toBase58());
      console.log("Token Account:", tokenAccount.toBase58());
    }
    // Check balances first
    const creatorBalance = await connection.getBalance(
      redPacketCreator.publicKey
    );
    const claimer1Balance = await connection.getBalance(randomUser.publicKey);
    const claimer2Balance = await connection.getBalance(randomUser2.publicKey);

    if (
      creatorBalance < 3 * LAMPORTS_PER_SOL ||
      claimer1Balance < 1 * LAMPORTS_PER_SOL ||
      claimer2Balance < 1 * LAMPORTS_PER_SOL
    ) {
      console.log("creatorBalance", creatorBalance);
      console.log("claimer1Balance", claimer1Balance);
      console.log("claimer2Balance", claimer2Balance);
      throw new Error(
        "Insufficient SOL in redPacketCreator account. Please fund it with at least 5 SOL before running tests."
      );
    }
  });
  it("create SPL token redpacket", async () => {
    const creatorTokenBalanceBefore = await connection.getTokenAccountBalance(
      tokenAccount
    );
    const creatorTokenBalanceBeforeAmount = new anchor.BN(
      creatorTokenBalanceBefore.value.amount
    );
    console.log(
      "In test case token account balance before create redpacket",
      creatorTokenBalanceBeforeAmount.toString()
    );

    splRedPacketCreateTime = new anchor.BN(Math.floor(Date.now() / 1000));
    splTokenRedPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(splRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    console.log("Create time:", splRedPacketCreateTime.toString());
    console.log("splTokenRedPacket:", splTokenRedPacket.toString());
    //console.log("bump:", bump);
    vault = getAssociatedTokenAddressSync(
      tokenMint,
      splTokenRedPacket,
      true,
      TOKEN_PROGRAM
    );

    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(5 * LAMPORTS_PER_SOL);
    const redPacketDuration = new anchor.BN(15);

    try {
      const tx = await redPacketProgram.methods
        .createRedPacketWithSplToken(
          redPacketTotalNumber,
          redPacketTotalAmount,
          splRedPacketCreateTime,
          redPacketDuration,
          false,
          claimer_issuer.publicKey
        )
        .accounts({
          signer: redPacketCreator.publicKey,
          redPacket: splTokenRedPacket,
          tokenMint: tokenMint,
          tokenAccount: tokenAccount,
          vault: vault,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([redPacketCreator])
        .rpc();

      await provider.connection.confirmTransaction(tx);
      //await getLogs(tx);
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

    // After creating red packet
    const creatorTokenBalanceAfter = await connection.getTokenAccountBalance(
      tokenAccount
    );

    expect(vaultBalance.toString()).equal(redPacketTotalAmount.toString());
    expect(creatorTokenBalanceAfter.value.amount).equal(
      creatorTokenBalanceBeforeAmount.sub(vaultBalance).toString()
    );

    // Check red packet
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      splTokenRedPacket
    );
    const currentTime = Math.floor(Date.now() / 1000);
    //splRedPacketCreateTime = new anchor.BN(currentTime);

    // Verify time drift
    const timeDrift = Math.abs(
      currentTime - redPacketAccount.createTime.toNumber()
    );
    console.log("Time drift:", timeDrift, "seconds");
    //expect(timeDrift).to.be.lessThan(ALLOWED_TIME_DRIFT);

    expect(redPacketAccount.totalNumber.toString()).equal(
      redPacketTotalNumber.toString()
    );
    expect(redPacketAccount.totalAmount.toString()).equal(
      redPacketTotalAmount.toString()
    );
    expect(redPacketAccount.createTime.toString()).equal(
      redPacketAccount.createTime.toString()
    );
    expect(redPacketAccount.duration.toString()).equal(
      redPacketAccount.duration.toString()
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
    const redPacketDuration = new anchor.BN(1000 * 60 * 60 * 24);
    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);

    nativeRedPacketCreateTime = splRedPacketCreateTime.add(new anchor.BN(1));

    nativeTokenRedPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(nativeRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    const tx = await redPacketProgram.methods
      .createRedPacketWithNativeToken(
        redPacketTotalNumber,
        redPacketTotalAmount,
        nativeRedPacketCreateTime,
        redPacketDuration,
        false, // if_split_random
        claimer_issuer.publicKey
      )
      .accounts({
        signer: redPacketCreator.publicKey,
        redPacket: nativeTokenRedPacket,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([redPacketCreator])
      .rpc();
    await provider.connection.confirmTransaction(tx);
    // Fetch and verify the created red packet account
    //await getLogs(tx);

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

    expect(redPacketAccount.tokenType).equal(0);
    expect(redPacketAccount.ifSpiltRandom).equal(false);
    expect(redPacketAccount.claimedNumber.toString()).equal("0");
    expect(redPacketAccount.claimedAmount.toString()).equal("0");
    expect(redPacketAccount.creator.toString()).equal(
      redPacketCreator.publicKey.toString()
    );
  });

  it("claim spl token red packet", async () => {
    // Re-derive the PDA
    const redPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(splRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    // const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
    //   redPacket
    // );

    console.log("in claim, Re-derived redPacket", redPacket.toString());

    // // Verify they match
    // expect(redPacket.toString()).to.equal(splTokenRedPacket.toString());

    // Get claimer's token account
    const claimerTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      randomUser.publicKey,
      false,
      TOKEN_PROGRAM
    );

    // Get vault account
    const vaultAccount = getAssociatedTokenAddressSync(
      tokenMint,
      redPacket,
      true,
      TOKEN_PROGRAM
    );
    console.log("vaultAccount", vaultAccount.toString());

    try {
      // Generate the message
      const message = Buffer.concat([
        redPacket.toBytes(),
        randomUser.publicKey.toBytes(),
      ]);

      console.log(
        "claim issuer publicKey",
        claimer_issuer.publicKey.toString()
      );

      // Sign the message
      const signature = nacl.sign.detached(message, claimer_issuer.secretKey);

      const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
        publicKey: claimer_issuer.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      // Verify signature before creating instruction
      const verifyResult = nacl.sign.detached.verify(
        message,
        signature,
        claimer_issuer.publicKey.toBytes()
      );
      console.log("Signature verification in TS:", verifyResult);

      const tx = await redPacketProgram.methods
        .claimWithSplToken()
        .accounts({
          signer: randomUser.publicKey,
          redPacket,
          tokenMint: tokenMint,
          tokenAccount: claimerTokenAccount,
          vault: vaultAccount,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([ed25519Instruction])
        .signers([randomUser])
        .rpc();
      await provider.connection.confirmTransaction(tx);
    } catch (error) {
      console.error("Transaction failed:", error);
      if (error.logs) {
        console.log("Transaction logs:", error.logs);
      }
      throw error;
    }

    // Fetch and verify the updated red packet state
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );
    expect(redPacketAccount.claimedNumber.toString()).to.equal("1");
    expect(redPacketAccount.claimedUsers.length).to.equal(1);
    expect(redPacketAccount.claimedUsers[0].toString()).to.equal(
      randomUser.publicKey.toString()
    );
    expect(redPacketAccount.claimedAmountRecords.length).to.equal(1);

    // Verify claimer received tokens
    const claimerBalanceAfter = await connection.getTokenAccountBalance(
      claimerTokenAccount
    );
    expect(Number(claimerBalanceAfter.value.amount)).to.be.greaterThan(0);

    expect(redPacketAccount.claimedAmountRecords[0].toString()).to.equal(
      claimerBalanceAfter.value.amount
    );
    console.log(
      "redpacket claimerAmount:",
      redPacketAccount.claimedAmount.toString()
    );
    console.log("claimerBalance now", claimerBalanceAfter.value.amount);
  });

  it("fail to claim spl red packet because of invalid signature", async () => {
    // Re-derive the PDA
    const redPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(splRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    // Get claimer's token account
    const claimerTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      randomUser2.publicKey,
      false,
      TOKEN_PROGRAM
    );

    // Get vault account
    const vaultAccount = getAssociatedTokenAddressSync(
      tokenMint,
      redPacket,
      true,
      TOKEN_PROGRAM
    );

    try {
      // Generate the message
      const message = Buffer.concat([
        redPacket.toBytes(),
        randomUser2.publicKey.toBytes(),
      ]);
      // randomUser sign the message, so the signature is invalid
      const signature = nacl.sign.detached(message, randomUser.secretKey);

      const ed25519Instruction2 = Ed25519Program.createInstructionWithPublicKey(
        {
          publicKey: randomUser.publicKey.toBytes(),
          message: message,
          signature: signature,
        }
      );

      // Verify signature before creating instruction
      const verifyResult = nacl.sign.detached.verify(
        message,
        signature,
        randomUser.publicKey.toBytes()
      );
      console.log("Signature verification in TS:", verifyResult);

      const tx = await redPacketProgram.methods
        .claimWithSplToken()
        .accounts({
          signer: randomUser2.publicKey,
          redPacket,
          tokenMint: tokenMint,
          tokenAccount: claimerTokenAccount,
          vault: vaultAccount,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([ed25519Instruction2])
        .signers([randomUser2])
        .rpc();
      await provider.connection.confirmTransaction(tx);

      assert.fail("Expected transaction to fail with InvalidSignature error");
    } catch (error) {
      // Verify we got the expected error
      console.log("catch error part");
      expect(error.error.errorCode.code).to.equal("InvalidSignature");
      expect(error.error.errorCode.number).to.equal(6009);
    }
  });

  it("claim native token red packet", async () => {
    // Re-derive the PDA
    const redPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(nativeRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    const claimerBalanceBefore = await connection.getBalance(
      randomUser.publicKey
    );

    // Generate the message
    const message = Buffer.concat([
      redPacket.toBytes(),
      randomUser.publicKey.toBytes(),
    ]);
    console.log("Original message:", bs58.encode(message));

    // Sign the message
    const signature = nacl.sign.detached(message, claimer_issuer.secretKey);

    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: claimer_issuer.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    const tx = await redPacketProgram.methods
      .claimWithNativeToken()
      .accounts({
        redPacket,
        signer: randomUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([ed25519Instruction])
      .signers([randomUser])
      .rpc();
    await provider.connection.confirmTransaction(tx);

    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );

    expect(redPacketAccount.claimedNumber.toString()).equal("1");
    // expect(redPacketAccount.claimedAmount.toString()).equal(
    //   (1 * LAMPORTS_PER_SOL).toString()
    // );
    const claimerBalanceAfter = await connection.getBalance(
      randomUser.publicKey
    );
    console.log(
      "redpacket claimerAmount:",
      redPacketAccount.claimedAmount.toString()
    );
    console.log("claimerBalanceAfter:", claimerBalanceAfter.toString());
    console.log(
      "claimerBalanceDiff",
      (claimerBalanceAfter - claimerBalanceBefore).toString()
    );
    expect((claimerBalanceAfter - claimerBalanceBefore).toString()).equal(
      redPacketAccount.claimedAmount.toString()
    );
    expect(redPacketAccount.claimedUsers.length).equal(1);
    expect(redPacketAccount.claimedUsers[0].toString()).equal(
      randomUser.publicKey.toString()
    );
    expect(redPacketAccount.claimedAmountRecords.length).to.equal(1);
  });

  it("withdraw spl token red packet", async () => {
    // Re-derive the PDA
    const redPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(splRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    // Now perform withdrawal
    const withdrawTx = await redPacketProgram.methods
      .withdrawWithSplToken()
      .accounts({
        redPacket,
        signer: redPacketCreator.publicKey,
        vault: vault,
        tokenAccount: tokenAccount, // Will be created if it doesn't exist
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([redPacketCreator])
      .rpc();

    await provider.connection.confirmTransaction(withdrawTx);

    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );
    expect(redPacketAccount.withdrawStatus).equal(1);
  });

  it("withdraw native token red packet", async () => {
    // Re-derive the PDA
    const redPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(nativeRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];
    // Now perform withdrawal
    const withdrawTx = await redPacketProgram.methods
      .withdrawWithNativeToken()
      .accounts({
        redPacket,
        signer: redPacketCreator.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([redPacketCreator])
      .rpc();

    await provider.connection.confirmTransaction(withdrawTx);
    await getLogs(withdrawTx);
    //Check red packet
    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
    );
    expect(redPacketAccount.withdrawStatus).equal(1);
    const creatorBalanceAfter = await connection.getBalance(
      redPacketCreator.publicKey
    );
    console.log("creatorBalanceAfter", creatorBalanceAfter);
  });
}).slow(30000);

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
