use anchor_lang::prelude::*;

declare_id!("9iq46dQFnCFrwbYFQFWCFJaoMjnTiAsBKKva5R5Bp5QC");


#[program]
pub mod redpacket {
    use super::*;

    pub fn create_red_packet(ctx: Context<CreateRedPacket>, red_packet_id: u64, total_number: u64, total_amount: u64, expiry: i64) -> Result<()> {
   
        // expiry check
        let current_time = Clock::get()?.unix_timestamp;
        require!(expiry > current_time, CustomError::InvalidExpiry);

        require!(total_number > 0 && total_amount > 0, CustomError::InvalidTotalNumberOrAmount);

        // Transfer tokens from initializer to PDA account (red packet account)
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.owner.key(),
            &ctx.accounts.red_packet.key(),
            total_amount
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.red_packet.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    
        ctx.accounts.red_packet.set_inner(RedPacket{
            red_packet_id,
            owner: *ctx.accounts.owner.key,
            total_amount,
            claimed_amount: 0,
            total_number,
            claimed_number: 0,
            expiry,
        });

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < red_packet.expiry, CustomError::RedPacketExpired);
        require!(red_packet.claimed_number < red_packet.total_number, CustomError::RedPacketClaimed);

        let claim_amount = red_packet.total_amount / red_packet.total_number;
        red_packet.claimed_amount += claim_amount;
        red_packet.claimed_number += 1;

        // Transfer SOL from PDA to claimer
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= claim_amount;
        **ctx.accounts.claimer.to_account_info().try_borrow_mut_lamports()? += claim_amount;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, red_packet_id: u64) -> Result<()> {
        let red_packet = &mut ctx.accounts.red_packet;
        require!(red_packet.red_packet_id == red_packet_id, CustomError::InvalidRedPacketId);
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= red_packet.expiry, CustomError::RedPacketNotExpired);
        require!(red_packet.owner == *ctx.accounts.user.key, CustomError::Unauthorized);

        let remaining_amount = red_packet.total_amount - red_packet.claimed_amount;
        
        // Transfer remaining SOL back to the owner
        **red_packet.to_account_info().try_borrow_mut_lamports()? -= remaining_amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += remaining_amount;

        Ok(())
    }
}


#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct Claim<'info> {
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct Withdraw<'info> {
    #[account(mut, seeds = [red_packet_id.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(red_packet_id: u64)] 
pub struct CreateRedPacket<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8+64+64+64+64, seeds = [red_packet_id.to_le_bytes().as_ref()], bump)]
    pub red_packet: Account<'info, RedPacket>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct RedPacket {
    pub red_packet_id: u64,
    pub owner: Pubkey,
    pub total_number: u64,
    pub claimed_number: u64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub expiry: i64,
}


#[error_code]
pub enum CustomError {
    #[msg("Invalid red packet id.")]
    InvalidRedPacketId,
    #[msg("Invalid expiry.")]
    InvalidExpiry,
    #[msg("Invalid total number or amount.")]
    InvalidTotalNumberOrAmount,
    #[msg("The red packet has expired.")]
    RedPacketExpired,
    #[msg("The red packet has not yet expired.")]
    RedPacketNotExpired,
    #[msg("The red packet has been claimed.")]
    RedPacketClaimed,
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
}

