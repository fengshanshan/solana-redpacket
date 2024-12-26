use anchor_lang::prelude::*;

#[constant]
pub const RED_PACKET_SPILT_RANDOM: bool = true;

#[constant]
pub const RED_PACKET_SPILT_EQUAL: bool = false;

#[constant]
pub const RED_PACKET_USE_NATIVE_TOKEN: u8 = 0;

#[constant]
pub const RED_PACKET_USE_CUSTOM_TOKEN: u8 = 1;

#[constant]
pub const RED_PACKET_WITHDRAW_STATUS_NOT_WITHDRAW: u8 = 0;

#[constant]
pub const RED_PACKET_WITHDRAW_STATUS_CLAIMED: u8 = 1;

#[constant]
pub const CLAIM_ISSUER_PUBLIC_KEY: Pubkey = pubkey!("4qwNHZXcS52ytQA93mQoh6YbAhksgb4nspWhVJTkig9W");