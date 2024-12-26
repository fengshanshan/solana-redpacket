import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Redpacket } from "../target/types/redpacket";
import {
  confirmTransaction,
  createAccountsMintsAndTokenAccounts,
} from "@solana-developers/helpers";
import {
  Ed25519Program,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

import nacl from "tweetnacl";
import { decodeUTF8 } from "tweetnacl-util";
import bs58 from "bs58";

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
  const randomUser2 = anchor.web3.Keypair.generate();

  let redPacketCreator: anchor.web3.Keypair;
  let splTokenRedPacket: PublicKey;
  let nativeTokenRedPacket: PublicKey;
  let splRedPacketCreateTime: anchor.BN;
  let nativeRedPacketCreateTime: anchor.BN;
  let vault: PublicKey;
  let tokenMint: PublicKey;
  let tokenAccount: PublicKey;

  // We're going to reuse these accounts across multiple tests
  const nativeAccounts: Record<string, PublicKey> = {
    systemProgram: anchor.web3.SystemProgram.programId,
  };

  // const splTokenAccounts: Record<string, PublicKey> = {
  //   tokenProgram: TOKEN_PROGRAM,
  //   associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //   systemProgram: anchor.web3.SystemProgram.programId,
  // };

  const redPacketProgram = anchor.workspace.Redpacket as Program<Redpacket>;

  splRedPacketCreateTime = new anchor.BN(Math.floor(Date.now() / 1000));

  // splTokenAccounts.vault = vault;

  // // First create red packets
  // const splTokenRedPacketID = new anchor.BN(1);
  // const splTokenRedPacket = PublicKey.findProgramAddressSync(
  //   [redPacketCreator.publicKey, ],
  //   redPacketProgram.programId
  // )[0];

  // const nativeTokenRedPacketID = new anchor.BN(2);
  // const nativeTokenRedPacket = PublicKey.findProgramAddressSync(
  //   [nativeTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
  //   redPacketProgram.programId
  // )[0];

  // const shortTimeSPLTokenRedPacketID = new anchor.BN(3);
  // const shortTimeSPLTokenRedPacket = PublicKey.findProgramAddressSync(
  //   [shortTimeSPLTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
  //   redPacketProgram.programId
  // )[0];

  // const shortTimeNativeTokenRedPacketID = new anchor.BN(4);
  // const shortTimeNativeTokenRedPacket = PublicKey.findProgramAddressSync(
  //   [shortTimeNativeTokenRedPacketID.toArrayLike(Buffer, "le", 8)],
  //   redPacketProgram.programId
  // )[0];

  // Add beforeAll if you need any setup before all tests
  before(async () => {
    //Create users and mints
    const usersMintsAndTokenAccounts =
      await createAccountsMintsAndTokenAccounts(
        [[100]],
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
  });

  it.only("create SPL token redpacket", async () => {
    const creatorTokenBalanceBefore = await connection.getTokenAccountBalance(
      tokenAccount
    );
    console.log(
      "In test case token account  balance",
      creatorTokenBalanceBefore.value.amount
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

    vault = getAssociatedTokenAddressSync(
      tokenMint,
      splTokenRedPacket,
      true,
      TOKEN_PROGRAM
    );

    const redPacketTotalNumber = new anchor.BN(3);
    const redPacketTotalAmount = new anchor.BN(3);
    const redPacketDuration = new anchor.BN(7 * 60 * 60 * 24);

    try {
      const tx = await redPacketProgram.methods
        .createRedPacketWithSplToken(
          redPacketTotalNumber,
          redPacketTotalAmount,
          splRedPacketCreateTime,
          redPacketDuration,
          false
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
      await getLogs(tx);
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
      vault
    );
    const creatorBalance = new anchor.BN(creatorBalanceResponse.value.amount);
    console.log("creatorBalance", creatorBalance.toString());

    // After creating red packet
    const creatorTokenBalanceAfter = await connection.getTokenAccountBalance(
      tokenAccount
    );
    expect(vaultBalance.toString()).equal("3");
    expect(creatorTokenBalanceAfter.value.amount).equal("97");

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
    const redPacketTotalAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);

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
        false // if_split_random
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

  it.only("claim spl token red packet", async () => {
    // Debug logs
    console.log("Creator:", redPacketCreator.publicKey.toString());
    console.log("Create time:", splRedPacketCreateTime.toString());

    // Re-derive the PDA
    const redPacket = PublicKey.findProgramAddressSync(
      [
        redPacketCreator.publicKey.toBuffer(),
        Buffer.from(splRedPacketCreateTime.toArray("le", 8)),
      ],
      redPacketProgram.programId
    )[0];

    console.log("Red Packet PDA:", redPacket.toString());
    console.log("Expected Red Packet:", splTokenRedPacket.toString());

    // Verify they match
    expect(redPacket.toString()).to.equal(splTokenRedPacket.toString());

    // Get claimer's token account
    const claimerTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      randomUser.publicKey,
      true,
      TOKEN_PROGRAM
    );

    // Get vault account
    const vaultAccount = getAssociatedTokenAddressSync(
      tokenMint,
      redPacket,
      true,
      TOKEN_PROGRAM
    );

    console.log("Vault account:", vaultAccount.toString());
    console.log("Expected vault:", vault.toString());

    // Verify vault matches
    expect(vaultAccount.toString()).to.equal(vault.toString());
    //const signatureBuffer = Buffer.from(signature);
    try {
      console.log("Random User Public Key:", randomUser.publicKey.toBase58());

      // Generate the message
      const message = Buffer.concat([
        redPacket.toBytes(),
        randomUser.publicKey.toBytes(),
      ]);
      console.log("Original message:", bs58.encode(message));

      // Sign the message
      const signature = nacl.sign.detached(message, randomUser.secretKey);

      // Verify signature before creating instruction
      const verifyResult = nacl.sign.detached.verify(
        message,
        signature,
        randomUser.publicKey.toBytes()
      );
      console.log("Signature verification:", verifyResult);

      // Important: Log the components before creating instruction
      console.log("Components before instruction creation:");
      console.log("- PublicKey:", randomUser.publicKey.toBase58());
      console.log(
        "- PublicKey bytes length:",
        randomUser.publicKey.toBytes().length
      );
      console.log("- Signature length:", signature.length);
      console.log("- Message length:", message.length);

      // Create Ed25519 instruction
      const pubkeyBytes = randomUser.publicKey.toBytes();
      console.log("\nCreating Ed25519 instruction with:");
      console.log("PublicKey:", randomUser.publicKey.toBase58());
      console.log("PublicKey bytes:", Buffer.from(pubkeyBytes).toString("hex"));
      console.log("Message:", bs58.encode(message));
      console.log("Signature:", Buffer.from(signature).toString("hex"));

      // Create Ed25519 instruction data manually
      const NUM_SIGNATURES = 1;
      const SIGNATURE_OFFSET = 64;
      const PUBKEY_OFFSET = 32;
      const MESSAGE_OFFSET = 128;

      const instructionData = Buffer.alloc(MESSAGE_OFFSET + message.length);

      // Write header
      instructionData.writeUInt8(NUM_SIGNATURES, 0);
      instructionData.writeUInt32LE(SIGNATURE_OFFSET, 8);
      instructionData.writeUInt32LE(PUBKEY_OFFSET, 12);
      instructionData.writeUInt32LE(MESSAGE_OFFSET, 16);

      // Write data
      instructionData.set(pubkeyBytes, PUBKEY_OFFSET);
      instructionData.set(signature, SIGNATURE_OFFSET);
      instructionData.set(message, MESSAGE_OFFSET);

      // Create Ed25519 instruction
      const ed25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: Buffer.concat([
          Buffer.from([1]), // number of signatures
          Buffer.alloc(7), // padding
          Buffer.from(new Uint32Array([64]).buffer), // signature offset
          Buffer.from(new Uint32Array([32]).buffer), // public key offset
          Buffer.from(new Uint32Array([128]).buffer), // message offset
          Buffer.from(new Uint32Array([message.length]).buffer), // message length
          randomUser.publicKey.toBytes(), // public key
          Buffer.from(signature), // signature
          message, // message
        ]),
      });
      // Verify the instruction data
      const instructionPubkey = new PublicKey(
        ed25519Instruction.data.slice(32, 64)
      );
      const instructionMessage = ed25519Instruction.data.slice(128);
      const instructionSignature = ed25519Instruction.data.slice(64, 128);

      console.log("\nInstruction verification:");
      console.log("Original PublicKey:", randomUser.publicKey.toBase58());
      console.log("Instruction PublicKey:", instructionPubkey.toBase58());
      console.log("Original message:", bs58.encode(message));
      console.log("Instruction message:", bs58.encode(instructionMessage));
      console.log(
        "Signature verification with instruction data:",
        nacl.sign.detached.verify(
          instructionMessage,
          instructionSignature,
          instructionPubkey.toBytes()
        )
      );

      //Verify the instruction data
      const pubkeyFromInstruction = new PublicKey(
        ed25519Instruction.data.slice(PUBKEY_OFFSET, PUBKEY_OFFSET + 32)
      );
      const messageFromInstruction =
        ed25519Instruction.data.slice(MESSAGE_OFFSET);

      console.log("Verification after instruction creation:");
      console.log("- Original pubkey:", randomUser.publicKey.toBase58());
      console.log("- Instruction pubkey:", pubkeyFromInstruction.toBase58());
      console.log("- Original message:", bs58.encode(message));
      console.log(
        "- Instruction message:",
        bs58.encode(messageFromInstruction)
      );

      // Create claim instruction
      const claimInstruction = await redPacketProgram.methods
        .claimWithSplToken()
        .accounts({
          signer: randomUser.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          redPacket,
          tokenMint,
          tokenAccount: claimerTokenAccount,
          vault: vaultAccount,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          ed25519Program: Ed25519Program.programId,
        })
        .instruction();

      // Create transaction
      const transaction = new Transaction();

      // Important: Set recent blockhash first
      transaction.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
      transaction.feePayer = randomUser.publicKey;

      // Add instructions in correct order
      transaction.add(ed25519Instruction);
      transaction.add(claimInstruction);

      // Debug log the transaction setup
      console.log("\nTransaction setup:");
      console.log("Fee payer:", transaction.feePayer.toBase58());
      console.log("Recent blockhash:", transaction.recentBlockhash);
      transaction.instructions.forEach((ix, i) => {
        console.log(`\nInstruction ${i}:`);
        console.log("Program ID:", ix.programId.toBase58());
        console.log(
          "Keys:",
          ix.keys.map((k) => ({
            pubkey: k.pubkey.toBase58(),
            signer: k.isSigner,
            writable: k.isWritable,
          }))
        );
      });

      const txSignature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [randomUser],
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          commitment: "confirmed",
        }
      );
      console.log("Transaction signature:", txSignature);
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

    // Verify claimer received tokens
    const claimerBalance = await connection.getTokenAccountBalance(
      claimerTokenAccount
    );
    expect(Number(claimerBalance.value.amount)).to.be.greaterThan(0);
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

    const tx = await redPacketProgram.methods
      .claimWithNativeToken()
      .accounts({
        redPacket,
        signer: randomUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([randomUser])
      .rpc();
    await provider.connection.confirmTransaction(tx);

    const redPacketAccount = await redPacketProgram.account.redPacket.fetch(
      redPacket
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
    console.log(withdrawTx);

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
});

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
