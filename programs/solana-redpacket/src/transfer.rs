use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, transfer_checked, TokenInterface, TransferChecked};

pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: &u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let transfer_accounts_options = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };

    let cpi_context = CpiContext::new_with_signer(token_program.to_account_info(), transfer_accounts_options, signer_seeds);

    transfer_checked(cpi_context, *amount, mint.decimals)
}