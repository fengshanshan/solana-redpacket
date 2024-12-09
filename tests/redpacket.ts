import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Redpacket } from "../target/types/redpacket";
const web3 = anchor.web3;

describe("redpacket", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const user = (provider.wallet as anchor.Wallet).payer;
  const randomUser = anchor.web3.Keypair.generate();

  const redPacketProgram = anchor.workspace.Redpacket as Program<Redpacket>;

  it("create red packet successfully", async () => {
    // create red packet
    const tx = await redPacketProgram.methods
      .createRedPacket(
        new anchor.BN(1),
        new anchor.BN(2),
        new anchor.BN(3),
        new anchor.BN(Date.now() + 1000 * 60 * 60 * 24)
      )
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("claim red packet successfully", async () => {
    // First create a red packet
    const redPacketId = new anchor.BN(2);
    const totalNumber = new anchor.BN(2);
    const totalAmount = new anchor.BN(web3.LAMPORTS_PER_SOL * 2); // 2 SOL
    const expiry = new anchor.BN(Date.now() / 1000 + 60 * 60); // 1 hour from now

    // Get PDA for red packet account
    const [redPacketPDA] = web3.PublicKey.findProgramAddressSync(
      [redPacketId.toBuffer("le", 8)],
      redPacketProgram.programId
    );

    // Create red packet
    await redPacketProgram.methods
      .createRedPacket(redPacketId, totalNumber, totalAmount, expiry)
      .accounts({
        owner: user.publicKey,
        redPacket: redPacketPDA,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    // Claim red packet
    const tx = await redPacketProgram.methods
      .claim(redPacketId)
      .accounts({
        redPacket: redPacketPDA,
        claimer: randomUser.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([randomUser])
      .rpc();

    console.log("Your transaction signature", tx);
  });

  it("withdraw red packet failed because red packet is not expired", async () => {
    // 设置初始时间
    const initialTime = new Date().getTime();

    // First create a red packet
    const redPacketId = new anchor.BN(3);
    const totalNumber = new anchor.BN(2);
    const totalAmount = new anchor.BN(web3.LAMPORTS_PER_SOL * 2); // 2 SOL
    const expiry = new anchor.BN(Date.now() / 1000 + 60 * 60); // 1 hour from now

    // Get PDA for red packet account
    const [redPacketPDA] = web3.PublicKey.findProgramAddressSync(
      [redPacketId.toBuffer("le", 8)],
      redPacketProgram.programId
    );

    await redPacketProgram.methods
      .createRedPacket(redPacketId, totalNumber, totalAmount, expiry)
      .accounts({
        owner: user.publicKey,
        redPacket: redPacketPDA,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    const tx = await redPacketProgram.methods
      .withdraw(redPacketId)
      .accounts({
        redPacket: redPacketPDA,
        user: user.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Your transaction signature", tx);
  });
});
