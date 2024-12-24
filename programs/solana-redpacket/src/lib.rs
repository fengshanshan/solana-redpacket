pub mod constants;
pub mod transfer;

use anchor_lang::{
    prelude::*,
    solana_program::hash::hash,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
pub use constants::*;
pub use transfer::*;

declare_id!("4ezSV2k7oeZZnc6MoV33j56d73MSzBHUSYAttXCD5f2k");


#[program]
pub mod redpacket {
    use super::*;

    pub fn create_red_packet_with_spl_token(ctx: Context<CreateRedPacketWithSPLToken>, total_number: u64, total_amount: u64, create_time: u64, duration: u64, if_spilt_random: bool) -> Result<()> {
        // params check
        require!(total_number > 0 && total_amount > 0, CustomError::InvalidTotalNumberOrAmount);
        // time check
        let _current_time = Clock::get().unwrap().unix_timestamp;
        // create time valid check
        // TODO:  maybe need to give a more reasonable time range   
        require!((_current_time - create_time as i64).abs() <= 2, CustomError::InvalidCreateTime);
        // expiry time valid
        require!(create_time + duration > _current_time as u64, CustomError::InvalidExpiryTime);

        require!(ctx.accounts.token_account.amount >= total_amount, CustomError::InvalidTokenAmount);

        //Transfer SPL tokens from initializer to PDA account (red packet account)
        //Signer seeds for PDA authority
        let binding = ctx.accounts.signer.key();
        let seeds = &[binding.as_ref(), &create_time.to_le_bytes()];      
        let signer_seeds = &[&seeds[..]];

        transfer::transfer_tokens(
            &ctx.accounts.token_account,
            &ctx.accounts.vault,
            &total_amount,
            &ctx.accounts.token_mint,
            &ctx.accounts.signer.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds
        )?;       
        initialize_red_packet(&mut ctx.accounts.red_packet, *ctx.accounts.signer.key, total_number, total_amount, create_time, duration, constants::RED_PACKET_USE_CUSTOM_TOKEN, ctx.accounts.token_mint.key(), if_spilt_random);

        Ok(())
    }

    pub fn create_red_packet_with_native_token(ctx: Context<CreateRedPacketWithNativeToken>, total_number: u64, total_amount: u64, create_time: u64, duration: u64, if_spilt_random: bool) -> Result<()> {
        // params check
        require!(total_number > 0 && total_amount > 0, CustomError::InvalidTotalNumberOrAmount);
    
        // time check
        let _current_time = Clock::get().unwrap().unix_timestamp;
        // create time valid check
        // TODO:  maybe need to give a more reasonable time range 
        require!((_current_time - create_time as i64).abs() <= 2, CustomError::InvalidCreateTime);
        require!(create_time + duration > _current_time as u64, CustomError::InvalidExpiryTime);

        require!(ctx.accounts.signer.lamports() >= total_amount, CustomError::InvalidTokenAmount);
        // Transfer tokens from initializer to PDA account (red packet account)
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.signer.key(),
            &ctx.accounts.red_packet.key(),
            total_amount
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.signer.to_account_info(),
                ctx.accounts.red_packet.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        initialize_red_packet(&mut ctx.accounts.red_packet, *ctx.accounts.signer.key, total_number, total_amount, create_time, duration, constants::RED_PACKET_USE_NATIVE_TOKEN, Pubkey::default(), if_spilt_random);

        Ok(())

    }
    
    pub fn claim_with_spl_token(ctx: Context<RedPacketWithSPLToken>) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        let _current_time = Clock::get().unwrap().unix_timestamp;
        let expiry = red_packet.create_time + red_packet.duration;
        require!(_current_time < expiry as i64, CustomError::RedPacketExpired);
        
        require!(red_packet.claimed_number < red_packet.total_number, CustomError::RedPacketAllClaimed);
        require!(!red_packet.claimed_users.contains(&ctx.accounts.signer.key()), CustomError::RedPacketClaimed);
        let claim_amount = calculate_claim_amount(&red_packet, ctx.accounts.signer.key());

        // check if the claim amount is valid
        require!(red_packet.claimed_amount + claim_amount <= red_packet.total_amount, CustomError::InvalidClaimAmount);
        
        // Transfer SPL tokens from vault to claimer's token account
        // Signer seeds for PDA authority
        let binding = red_packet.creator.key();
        let binding_time = red_packet.create_time.to_le_bytes();
        let seeds = &[binding.as_ref(), binding_time.as_ref(), &[ctx.bumps.red_packet]];
        let signer_seeds = &[&seeds[..]];
        transfer::transfer_tokens(
            &ctx.accounts.vault,
            &ctx.accounts.token_account,
            &claim_amount,
            &ctx.accounts.token_mint,
            &red_packet.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds
        )?;
        
        red_packet.claimed_users.push(ctx.accounts.signer.key());
        red_packet.claimed_number += 1;
        red_packet.claimed_amount += claim_amount;

        Ok(())
    }

    pub fn claim_with_native_token(ctx: Context<RedPacketWithNativeToken>) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;

        let current_time: u64 = Clock::get()?.unix_timestamp.try_into().unwrap();
        let expiry = red_packet.create_time + red_packet.duration;
        require!(current_time < expiry, CustomError::RedPacketExpired);
        require!(red_packet.claimed_number < red_packet.total_number, CustomError::RedPacketAllClaimed);
        require!(!red_packet.claimed_users.contains(&ctx.accounts.signer.key()), CustomError::RedPacketClaimed);
        let claim_amount = calculate_claim_amount(&red_packet, ctx.accounts.signer.key());
        
        // check if the claim amount is valid
        require!(red_packet.claimed_amount + claim_amount <= red_packet.total_amount, CustomError::InvalidClaimAmount);
       
        // Transfer SOL using native transfer
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= claim_amount;
        **ctx.accounts.signer.to_account_info().try_borrow_mut_lamports()? += claim_amount;
               
        red_packet.claimed_users.push(ctx.accounts.signer.key());
        red_packet.claimed_number += 1;
        red_packet.claimed_amount += claim_amount;

        Ok(())
    }

    pub fn withdraw_with_spl_token(ctx: Context<RedPacketWithSPLToken>) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.withdraw_status == constants::RED_PACKET_WITHDRAW_STATUS_NOT_WITHDRAW, CustomError::RedPacketWithdrawn);
        let _current_time: u64 = Clock::get()?.unix_timestamp.try_into().unwrap();
        let expiry = red_packet.create_time + red_packet.duration;
        require!(_current_time >= expiry, CustomError::RedPacketNotExpired);
        require!(red_packet.creator == *ctx.accounts.signer.key, CustomError::Unauthorized);

        let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
       
        // Transfer SPL tokens from vault to claimer's token account
        // Signer seeds for PDA authority
        let binding = red_packet.creator.key();
        let binding_time = red_packet.create_time.to_le_bytes();
        let seeds = &[binding.as_ref(), binding_time.as_ref(), &[ctx.bumps.red_packet]];
        let signer_seeds = &[&seeds[..]];
        transfer::transfer_tokens(
            &ctx.accounts.vault,
            &ctx.accounts.token_account,
            &remaining_amount,
            &ctx.accounts.token_mint,
            &red_packet.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds
        )?;

        red_packet.withdraw_status = 1;

        Ok(())
    }

    pub fn withdraw_with_native_token(ctx: Context<RedPacketWithNativeToken>) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.withdraw_status == constants::RED_PACKET_WITHDRAW_STATUS_NOT_WITHDRAW, CustomError::RedPacketWithdrawn);
        let current_time: u64 = Clock::get()?.unix_timestamp.try_into().unwrap();
        let expiry = red_packet.create_time + red_packet.duration;
        require!(current_time >= expiry, CustomError::RedPacketNotExpired);
        require!(red_packet.creator == *ctx.accounts.signer.key, CustomError::Unauthorized);

        let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
        
        // Transfer remaining SOL back to the creator
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= remaining_amount;
        **ctx.accounts.signer.to_account_info().try_borrow_mut_lamports()? += remaining_amount;
        red_packet.withdraw_status = 1;
        Ok(())
    }

}


#[derive(Accounts)]
#[instruction(total_number: u64, total_amount: u64, create_time: u64, duration: u64, if_spilt_random: bool)] 
pub struct CreateRedPacketWithSPLToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    
    #[account(
        init, 
        payer = signer, 
        space = 8 + RedPacket::INIT_SPACE, 
        seeds = [signer.key().as_ref(), create_time.to_le_bytes().as_ref()], 
        bump
    )]
    pub red_packet: Account<'info, RedPacket>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init,
        payer = signer,
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
pub struct RedPacketWithSPLToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    
    #[account(mut, seeds = [red_packet.creator.key().as_ref(), red_packet.create_time.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed, 
        payer = signer,
        associated_token::mint = token_mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
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
#[instruction(total_number: u64, total_amount: u64, create_time: u64, duration: u64, if_spilt_random: bool)] 
pub struct CreateRedPacketWithNativeToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(init, payer = signer, space = 8 + RedPacket::INIT_SPACE, seeds = [signer.key().as_ref(), create_time.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedPacketWithNativeToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut, seeds = [red_packet.creator.key().as_ref(), red_packet.create_time.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct RedPacket {
    pub creator: Pubkey,
    pub total_number: u64,
    pub claimed_number: u64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub create_time: u64,
    pub duration: u64,
    pub token_type: u8, // 0: SOL, 1: SPL Token
    pub token_address: Pubkey,
    pub if_spilt_random: bool,
    #[max_len(100)]
    pub claimed_users: Vec<Pubkey>, // Record of claimers
    pub withdraw_status: u8, // 0: not withdraw, 1: withdraw
}

pub fn initialize_red_packet(
    red_packet: &mut Account<RedPacket>,
    creator: Pubkey,
    total_number: u64,
    total_amount: u64,
    create_time: u64,
    duration: u64,
    token_type: u8,
    token_address: Pubkey,
    if_spilt_random: bool,
) {
    red_packet.set_inner(RedPacket {
        creator,
        total_number,
        claimed_number: 0,
        total_amount,
        claimed_amount: 0,
        create_time,
        duration,
        token_type,
        token_address,
        if_spilt_random,
        claimed_users: vec![],
        withdraw_status: 0,
    });
}

fn calculate_claim_amount(red_packet: &Account<RedPacket>, signer_key: Pubkey) -> u64 {
    let claim_amount: u64;

    let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
    if red_packet.total_number - red_packet.claimed_number == 1 {
        return remaining_amount;
    }

    if red_packet.if_spilt_random == constants::RED_PACKET_SPILT_EQUAL {
        claim_amount = red_packet.total_amount / red_packet.total_number;   
    } else {
        let random_value = generate_random_number(red_packet.key(), signer_key);
        let claim_value = random_value % ((remaining_amount * 2) / (red_packet.total_number - red_packet.claimed_number));
        claim_amount = if claim_value == 0 { 1 } else { claim_value };
    } 
    msg!("claim_amount: {}", claim_amount);
    return claim_amount;
}

fn generate_random_number(redpacket_key: Pubkey, signer_key: Pubkey) -> u64 {
    let clock = Clock::get().unwrap();
    let current_timestamp = clock.unix_timestamp;

    let seed = format!("{}{}{}", redpacket_key, signer_key, current_timestamp);
    let hash_value = hash(seed.as_bytes()); 
    u64::from_le_bytes(hash_value.to_bytes()[0..8].try_into().unwrap())
}

#[error_code]
pub enum CustomError {
    #[msg("Invalid red packet id.")]
    InvalidRedPacketId,
    #[msg("Invalid create time.")]
    InvalidCreateTime,
    #[msg("Invalid expiry time.")]
    InvalidExpiryTime,
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
    #[msg("The red packet has been withdrawn.")]
    RedPacketWithdrawn,
}