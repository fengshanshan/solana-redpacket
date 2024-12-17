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

    pub fn create_red_packet_with_spl_token(ctx: Context<CreateRedPacketWithSPLToken>, red_packet_id: u64, total_number: u64, total_amount: u64, expiry: u64, if_spilt_random: bool) -> Result<()> {
        // params check
        require!(total_number > 0 && total_amount > 0, CustomError::InvalidTotalNumberOrAmount);
        // expiry check
        let current_time = Clock::get()?.unix_timestamp;
        require!(expiry > current_time.try_into().unwrap(), CustomError::InvalidExpiry);

        msg!("ctx.accounts.token_account.amount: {} {}", ctx.accounts.token_account.amount, total_amount);
        require!(ctx.accounts.token_account.amount >= total_amount, CustomError::InvalidTokenAmount);
        // Transfer SPL tokens from initializer to PDA account (red packet account)
            // Signer seeds for PDA authority
    let binding = red_packet_id.to_le_bytes();
    let seeds = &[binding.as_ref(), &[ctx.bumps.red_packet]];
    let signer_seeds = &[&seeds[..]];
        transfer::transfer_tokens(
            &ctx.accounts.token_account,
            &ctx.accounts.vault,
            &total_amount,
            &ctx.accounts.token_mint,
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds
        )?;
            
        initialize_red_packet(&mut ctx.accounts.red_packet, red_packet_id, *ctx.accounts.creator.key, total_number, total_amount, expiry, constants::RED_PACKET_USE_CUSTOM_TOKEN, ctx.accounts.token_mint.key(), if_spilt_random);

        Ok(())
    }

    pub fn create_red_packet_with_native_token(ctx: Context<CreateRedPacketWithNativeToken>, red_packet_id: u64, total_number: u64, total_amount: u64, expiry: u64, if_spilt_random: bool) -> Result<()> {
        // params check
        require!(total_number > 0 && total_amount > 0, CustomError::InvalidTotalNumberOrAmount);
        // expiry check
        let current_time = Clock::get()?.unix_timestamp;
        require!(expiry > current_time.try_into().unwrap(), CustomError::InvalidExpiry);

        require!(ctx.accounts.creator.lamports() >= total_amount, CustomError::InvalidTokenAmount);
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

        initialize_red_packet(&mut ctx.accounts.red_packet, red_packet_id, *ctx.accounts.creator.key, total_number, total_amount, expiry, constants::RED_PACKET_USE_NATIVE_TOKEN, Pubkey::default(), if_spilt_random);

        Ok(())

    }

    pub fn claim_with_spl_token(ctx: Context<ClaimWithSPLToken>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        
        require!(current_time < red_packet.expiry.try_into().unwrap(), CustomError::RedPacketExpired);
        require!(red_packet.claimed_number < red_packet.total_number, CustomError::RedPacketAllClaimed);
        require!(!red_packet.claimed_users.contains(&ctx.accounts.claimer.key()), CustomError::RedPacketClaimed);
        let claim_amount: u64;
       
       if red_packet.if_spilt_random == constants::RED_PACKET_SPILT_EQUAL {
            claim_amount = red_packet.total_amount / red_packet.total_number;
       } else {
            // todo spilt random
            unimplemented!();
       } 

        // check if the claim amount is valid
        require!(red_packet.claimed_amount + claim_amount <= red_packet.total_amount, CustomError::InvalidClaimAmount);
        
        // Transfer SPL tokens from vault to claimer's token account
        // Signer seeds for PDA authority
        let binding = red_packet_id.to_le_bytes();
        let seeds = &[binding.as_ref(), &[ctx.bumps.red_packet]];
        let signer_seeds = &[&seeds[..]];
        transfer::transfer_tokens(
            &ctx.accounts.vault,
            &ctx.accounts.claimer_token_account,
            &claim_amount,
            &ctx.accounts.token_mint,
            &red_packet.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds
        )?;
        
        red_packet.claimed_users.push(ctx.accounts.claimer.key());
        red_packet.claimed_number += 1;
        red_packet.claimed_amount += claim_amount;

        Ok(())
    }

    pub fn claim_with_native_token(ctx: Context<ClaimWithNativeToken>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        
        require!(current_time < red_packet.expiry.try_into().unwrap(), CustomError::RedPacketExpired);
        require!(red_packet.claimed_number < red_packet.total_number, CustomError::RedPacketAllClaimed);
        require!(!red_packet.claimed_users.contains(&ctx.accounts.claimer.key()), CustomError::RedPacketClaimed);
        let claim_amount: u64;
       
        if red_packet.if_spilt_random == constants::RED_PACKET_SPILT_EQUAL {
            msg!("red_packet.total_amount: {}", red_packet.total_amount);
            claim_amount = red_packet.total_amount / red_packet.total_number;
            msg!("red_packet.total_amount: {}", red_packet.total_amount);
        } else {
            // todo spilt random
            unimplemented!();
        } 
        // check if the claim amount is valid
        require!(red_packet.claimed_amount + claim_amount <= red_packet.total_amount, CustomError::InvalidClaimAmount);
       
        // Transfer SOL using native transfer
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= claim_amount;
        **ctx.accounts.claimer.to_account_info().try_borrow_mut_lamports()? += claim_amount;
        
        
        red_packet.claimed_users.push(ctx.accounts.claimer.key());
        red_packet.claimed_number += 1;
        red_packet.claimed_amount += claim_amount;
        msg!("red_packet.total_amount: {}", red_packet.claimed_amount);

        Ok(())
    }

    pub fn withdraw_with_native_token(ctx: Context<WithdrawWithNativeToken>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= red_packet.expiry.try_into().unwrap(), CustomError::RedPacketNotExpired);
        require!(red_packet.creator == *ctx.accounts.signer.key, CustomError::Unauthorized);

        let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
        msg!("Remaining amount to withdraw: {}, total amount: {}, claimed amount: {}", remaining_amount, red_packet.total_amount, red_packet.claimed_amount);
        
        // Transfer remaining SOL back to the creator
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= remaining_amount;
        **ctx.accounts.signer.to_account_info().try_borrow_mut_lamports()? += remaining_amount;
        red_packet.withdraw_status = 1;
        Ok(())
    }

    pub fn withdraw_with_spl_token(ctx: Context<WithdrawWithSPLToken>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= red_packet.expiry.try_into().unwrap(), CustomError::RedPacketNotExpired);
        require!(red_packet.creator == *ctx.accounts.signer.key, CustomError::Unauthorized);

        let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
        msg!("Remaining amount to withdraw: {}, total amount: {}, claimed amount: {}", remaining_amount, red_packet.total_amount, red_packet.claimed_amount);
       
        // Transfer SPL tokens from vault to claimer's token account
        // Signer seeds for PDA authority
        let binding = red_packet_id.to_le_bytes();
        let seeds = &[binding.as_ref(), &[ctx.bumps.red_packet]];
        let signer_seeds = &[&seeds[..]];
        transfer::transfer_tokens(
            &ctx.accounts.vault,
            &ctx.accounts.signer_token_account,
            &remaining_amount,
            &ctx.accounts.token_mint,
            &red_packet.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds
        )?;

        red_packet.withdraw_status = 1;

        Ok(())
    }
}


#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct CreateRedPacketWithSPLToken<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    #[account(init, payer = creator, space = 8 + RedPacket::INIT_SPACE, seeds = [red_packet_id.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,

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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct CreateRedPacketWithNativeToken<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(init, payer = creator, space = 8 + RedPacket::INIT_SPACE, seeds = [red_packet_id.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct ClaimWithSPLToken<'info> {
    #[account(
        mut,
        seeds = [red_packet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub red_packet: Account<'info, RedPacket>,
    
    #[account(mut)]
    pub claimer: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = red_packet,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = claimer,
        associated_token::mint = token_mint,
        associated_token::authority = claimer,
        associated_token::token_program = token_program
    )]
    pub claimer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct ClaimWithNativeToken<'info> {
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump, realloc = 8 + RedPacket::INIT_SPACE, realloc::payer = claimer, realloc::zero = false)]
    pub red_packet: Account<'info, RedPacket>,
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct WithdrawWithSPLToken<'info> {
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump, realloc = 8 + RedPacket::INIT_SPACE, realloc::payer = signer, realloc::zero = true)]
    pub red_packet: Account<'info, RedPacket>,
    
    #[account(mut)]
    pub signer: Signer<'info>,
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = red_packet,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program
    )]
    pub signer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct WithdrawWithNativeToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump, realloc = 8 + RedPacket::INIT_SPACE, realloc::payer = signer, realloc::zero = true)]
    pub red_packet: Account<'info, RedPacket>,
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
    #[max_len(100)]
    pub claimed_users: Vec<Pubkey>, // Record of claimers
    pub withdraw_status: u8, // 0: not withdraw, 1: withdraw
}

pub fn initialize_red_packet(
    red_packet: &mut Account<RedPacket>,
    red_packet_id: u64,
    creator: Pubkey,
    total_number: u64,
    total_amount: u64,
    expiry: u64,
    token_type: u8,
    token_address: Pubkey,
    if_spilt_random: bool,
) {
    red_packet.set_inner(RedPacket {
        red_packet_id,
        creator,
        total_number,
        claimed_number: 0,
        total_amount,
        claimed_amount: 0,
        expiry,
        token_type,
        token_address,
        if_spilt_random,
        claimed_users: vec![],
        withdraw_status: 0,
    });
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
    #[msg("Invalid account for native token.")]
    InvalidAccountForNativeToken,
    #[msg("Invalid initial params for token account.")]
    InvalidInitialParamsForTokenAccount,
    #[msg("The red packet has expired.")]
    RedPacketExpired,
    #[msg("The claim amount is invalid.")]
    InvalidClaimAmount,
    #[msg("The red packet has not yet expired.")]
    RedPacketNotExpired,
    #[msg("The red packet has been claimed.")]
    RedPacketClaimed,
    #[msg("All the red packet has been claimed.")]
    RedPacketAllClaimed,
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
}

