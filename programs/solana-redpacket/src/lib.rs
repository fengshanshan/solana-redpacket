pub mod constants;
pub mod transfer;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
pub use constants::*;
pub use transfer::*;

declare_id!("E72QMqFFi8RmZt4q4ABkwBb3yZZWh8t91rs9zYREsFRR");


#[program]
pub mod redpacket {
    use super::*;

    pub fn create_red_packet(ctx: Context<CreateRedPacket>, red_packet_id: u64, total_number: u64, total_amount: u64, expiry: u64, token_type: u8, if_spilt_random: bool) -> Result<()> {
        // params check
        require!(total_number > 0 && total_amount > 0, CustomError::InvalidTotalNumberOrAmount);
        // expiry check
        let current_time = Clock::get()?.unix_timestamp;
        require!(expiry > current_time.try_into().unwrap(), CustomError::InvalidExpiry);

        if token_type == constants::RED_PACKET_USE_NATIVE_TOKEN {
            // Transfer tokens from initializer to PDA account (red packet account)
            let ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.creator.key(),
                &ctx.accounts.red_packet.key(),
                total_amount
            );
            anchor_lang::solana_program::program::invoke(
                &ix,
                &[
                    ctx.accounts.creator.to_account_info(),
                    ctx.accounts.red_packet.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;

        } else if token_type == constants::RED_PACKET_USE_CUSTOM_TOKEN {
            require!(ctx.accounts.token_account.amount >= total_amount, CustomError::InvalidTokenAmount);

            // Transfer SPL tokens from initializer to PDA account (red packet account)
            transfer::transfer_tokens(
                &ctx.accounts.token_account,
                &ctx.accounts.vault,
                &total_amount,
                &ctx.accounts.token_mint,
                &ctx.accounts.creator,
                &ctx.accounts.token_program
            )?;
        } else {
            return Err(CustomError::InvalidTokenType.into());
        }


        ctx.accounts.red_packet.set_inner(RedPacket{
            red_packet_id: red_packet_id,
            creator: *ctx.accounts.creator.key,
            total_amount,
            claimed_amount: 0,
            total_number,
            claimed_number: 0,
            expiry,
            token_type,
            token_address: if token_type == constants::RED_PACKET_USE_CUSTOM_TOKEN { ctx.accounts.token_mint.key() } else { Pubkey::default() },
            if_spilt_random,
        });

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < red_packet.expiry.try_into().unwrap(), CustomError::RedPacketExpired);
        require!(red_packet.claimed_number < red_packet.total_number, CustomError::RedPacketClaimed);

        let claim_amount: u64;
       
       if red_packet.if_spilt_random == constants::RED_PACKET_SPILT_EQUAL {
            claim_amount = red_packet.total_amount / red_packet.total_number;
            red_packet.claimed_amount += claim_amount;
            red_packet.claimed_number += 1;
       } else {
            // todo spilt random
            unimplemented!();
       } 
        
        // Transfer SOL from PDA to claimer
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= claim_amount;
        **ctx.accounts.claimer.to_account_info().try_borrow_mut_lamports()? += claim_amount;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= red_packet.expiry.try_into().unwrap(), CustomError::RedPacketNotExpired);
        require!(red_packet.creator == *ctx.accounts.user.key, CustomError::Unauthorized);

        let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
        
        // Transfer remaining SOL back to the creator
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= remaining_amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += remaining_amount;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct CreateRedPacket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    #[account(init, payer = creator, space = 8 + RedPacket::INIT_SPACE, seeds = [red_packet_id.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,
    
    pub system_program: Program<'info, System>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = red_packet,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
   
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct Claim<'info> {
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump, realloc = 8 + RedPacket::INIT_SPACE, realloc::payer = claimer, realloc::zero = false)]
    pub red_packet: Account<'info, RedPacket>,
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct Withdraw<'info> {
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump, realloc = 8 + RedPacket::INIT_SPACE, realloc::payer = user, realloc::zero = true)]
    pub red_packet: Account<'info, RedPacket>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct RedPacket {
    pub red_packet_id: u64,
    pub creator: Pubkey,
    pub total_number: u64,
    pub claimed_number: u64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub expiry: u64,
    pub token_type: u8, // 0: SOL, 1: SPL Token
    pub token_address: Pubkey,
    pub if_spilt_random: bool,
}


#[error_code]
pub enum CustomError {
    #[msg("Invalid red packet id.")]
    InvalidRedPacketId,
    #[msg("Invalid expiry.")]
    InvalidExpiry,
    #[msg("Invalid total number or amount.")]
    InvalidTotalNumberOrAmount,
    #[msg("Invalid token type.")]
    InvalidTokenType,
    #[msg("Invalid token amount.")]
    InvalidTokenAmount,
    #[msg("The red packet has expired.")]
    RedPacketExpired,
    #[msg("The red packet has not yet expired.")]
    RedPacketNotExpired,
    #[msg("The red packet has been claimed.")]
    RedPacketClaimed,
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
}

