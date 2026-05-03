// @generated
/// Amount can be XRP (drops), issued currency/token, or MPT
/// The format depends on which fields are populated:
/// - XRP: Only value field (drops as string)
/// - Token: value, currency, and issuer fields
/// - MPT: value and mpt_issuance_id fields
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Amount {
    /// Value of the amount
    /// For XRP: drops as string (e.g., "13100000" for 13.1 XRP)
    /// For token: decimal value as string, may use scientific notation (e.g., "153.75" or "1.23e11")
    /// For MPT: positive integer as string (0x0 to 0x7FFFFFFFFFFFFFFF)
    #[prost(string, tag="1")]
    pub value: ::prost::alloc::string::String,
    /// Currency code for tokens (3-char or 40-hex)
    /// Empty for XRP and MPTs
    /// Must not be "XRP" for tokens
    #[prost(string, tag="2")]
    pub currency: ::prost::alloc::string::String,
    /// Issuer address for tokens (empty for XRP and MPTs)
    /// The account that issues the token, or in special cases the holder
    #[prost(string, tag="3")]
    pub issuer: ::prost::alloc::string::String,
    /// MPT issuance ID (40-char hex string)
    /// Only used for MPT amounts
    /// Empty for XRP and tokens
    #[prost(string, tag="4")]
    pub mpt_issuance_id: ::prost::alloc::string::String,
}
/// Currency asset identifier (for AMM, specifying without amounts, etc.)
/// Can represent XRP, tokens, or MPTs:
/// - XRP: Only currency field set to "XRP"
/// - Token: currency and issuer fields (no issuer for XRP)
/// - MPT: Only mpt_issuance_id field
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Asset {
    /// Currency code (e.g., "USD", "XRP")
    /// Empty for MPTs
    #[prost(string, tag="1")]
    pub currency: ::prost::alloc::string::String,
    /// Issuer address for tokens
    /// Empty for XRP and MPTs
    #[prost(string, tag="2")]
    pub issuer: ::prost::alloc::string::String,
    /// MPT issuance ID (40-char hex string)
    /// Only used for MPT assets
    /// Empty for XRP and tokens
    #[prost(string, tag="3")]
    pub mpt_issuance_id: ::prost::alloc::string::String,
}
/// Path element for cross-currency payments
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PathElement {
    #[prost(string, tag="1")]
    pub account: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub currency: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub issuer: ::prost::alloc::string::String,
}
/// A full path is a sequence of path elements
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Path {
    #[prost(message, repeated, tag="1")]
    pub elements: ::prost::alloc::vec::Vec<PathElement>,
}
/// Signer in a multi-signature
/// Used in both transaction signers field and batch signers
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Signer {
    /// Address associated with this signature, as it appears in the signer list
    #[prost(string, tag="1")]
    pub account: ::prost::alloc::string::String,
    /// Signature for this transaction, verifiable using the signing_pub_key
    #[prost(string, tag="2")]
    pub txn_signature: ::prost::alloc::string::String,
    /// Public key used to create this signature
    #[prost(string, tag="3")]
    pub signing_pub_key: ::prost::alloc::string::String,
}
/// Payment transaction - transfers value from one account to another
/// Reference: <https://xrpl.org/payment.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Payment {
    /// Destination account
    #[prost(string, tag="1")]
    pub destination: ::prost::alloc::string::String,
    /// Amount to deliver to destination (alias for deliver_max in API v1)
    #[prost(message, optional, tag="2")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Maximum amount to deliver (API v2+, same as amount)
    #[prost(message, optional, tag="3")]
    pub deliver_max: ::core::option::Option<Amount>,
    /// (Optional) Maximum amount to send, including transfer fees
    #[prost(message, optional, tag="4")]
    pub send_max: ::core::option::Option<Amount>,
    /// (Optional) Minimum amount to deliver (for partial payments)
    #[prost(message, optional, tag="5")]
    pub deliver_min: ::core::option::Option<Amount>,
    /// (Optional) Payment paths for cross-currency payments
    #[prost(message, repeated, tag="6")]
    pub paths: ::prost::alloc::vec::Vec<Path>,
    /// (Optional) Arbitrary 256-bit hash for invoice/reference
    #[prost(string, tag="7")]
    pub invoice_id: ::prost::alloc::string::String,
    /// (Optional) Destination tag
    #[prost(uint32, tag="8")]
    pub destination_tag: u32,
    /// (Optional) Set of Credentials to authorize deposit (array of ledger entry IDs)
    #[prost(string, repeated, tag="9")]
    pub credential_ids: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    /// (Optional) Ledger entry ID of a permissioned domain
    /// For cross-currency payments, only use the permissioned DEX of that domain
    #[prost(string, tag="10")]
    pub domain_id: ::prost::alloc::string::String,
    /// (Optional) Transaction flags
    /// tfNoRippleDirect = 65536 (0x00010000) - Do not use default path
    /// tfPartialPayment = 131072 (0x00020000) - Allow partial payment
    /// tfLimitQuality = 262144 (0x00040000) - Only use paths with good quality
    #[prost(uint32, tag="11")]
    pub flags: u32,
    /// --- From metadata ---
    /// Actual amount delivered (may differ from amount for partial payments)
    #[prost(message, optional, tag="20")]
    pub delivered_amount: ::core::option::Option<Amount>,
}
/// OfferCreate - Places an order on the DEX
/// Reference: <https://xrpl.org/offercreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct OfferCreate {
    /// What the offer creator will pay (what taker gets)
    #[prost(message, optional, tag="1")]
    pub taker_gets: ::core::option::Option<Amount>,
    /// What the offer creator will receive (what taker pays)
    #[prost(message, optional, tag="2")]
    pub taker_pays: ::core::option::Option<Amount>,
    /// (Optional) Time after which offer expires (seconds since Ripple epoch)
    #[prost(uint32, tag="3")]
    pub expiration: u32,
    /// (Optional) Offer sequence to replace
    #[prost(uint32, tag="4")]
    pub offer_sequence: u32,
    /// (Optional) Ledger entry ID of a permissioned domain
    /// Restricts this offer to the permissioned DEX of that domain
    #[prost(string, tag="5")]
    pub domain_id: ::prost::alloc::string::String,
    /// (Optional) Transaction flags
    /// tfPassive = 65536 (0x00010000) - Do not consume offers that exactly match
    /// tfImmediateOrCancel = 131072 (0x00020000) - Immediate or Cancel order
    /// tfFillOrKill = 262144 (0x00040000) - Fill or Kill order
    /// tfSell = 524288 (0x00080000) - Exchange entire TakerGets amount
    /// tfHybrid = 1048576 (0x00100000) - Use both permissioned and open DEX
    #[prost(uint32, tag="6")]
    pub flags: u32,
}
/// OfferCancel - Cancels an existing offer
/// Reference: <https://xrpl.org/offercancel.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct OfferCancel {
    /// Sequence number of the offer to cancel
    #[prost(uint32, tag="1")]
    pub offer_sequence: u32,
}
/// TrustSet - Creates or modifies a trust line
/// Reference: <https://xrpl.org/trustset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TrustSet {
    /// The limit of the trust line (currency/issuer defines the line)
    /// currency: The currency code (3-char ISO 4217 or 160-bit hex)
    /// value: Quoted decimal limit to set on this trust line
    /// issuer: Address of the account to extend trust to
    #[prost(message, optional, tag="1")]
    pub limit_amount: ::core::option::Option<Amount>,
    /// (Optional) Value incoming balances at ratio of this per 1,000,000,000 units
    /// 0 = face value. E.g., 10,000,000 = 1% retained by sender
    #[prost(uint32, tag="2")]
    pub quality_in: u32,
    /// (Optional) Value outgoing balances at ratio of this per 1,000,000,000 units
    /// 0 = face value. E.g., 10,000,000 = 1% retained by issuer
    #[prost(uint32, tag="3")]
    pub quality_out: u32,
    /// (Optional) Transaction flags
    /// tfSetfAuth = 65536 (0x00010000) - Authorize other party to hold issued currency
    /// tfSetNoRipple = 131072 (0x00020000) - Enable No Ripple flag
    /// tfClearNoRipple = 262144 (0x00040000) - Disable No Ripple flag
    /// tfSetFreeze = 1048576 (0x00100000) - Freeze the trust line
    /// tfClearFreeze = 2097152 (0x00200000) - Unfreeze the trust line
    /// tfSetDeepFreeze = 4194304 (0x00400000) - Deep Freeze the trust line
    /// tfClearDeepFreeze = 8388608 (0x00800000) - Clear Deep Freeze on trust line
    #[prost(uint32, tag="4")]
    pub flags: u32,
}
/// AccountSet - Modifies account settings
/// Reference: <https://xrpl.org/accountset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AccountSet {
    /// Flag to enable
    #[prost(uint32, tag="1")]
    pub set_flag: u32,
    /// Flag to disable
    #[prost(uint32, tag="2")]
    pub clear_flag: u32,
    /// (Optional) Domain associated with account (hex-encoded)
    #[prost(string, tag="3")]
    pub domain: ::prost::alloc::string::String,
    /// (Optional) MD5 hash of email for Gravatar
    #[prost(string, tag="4")]
    pub email_hash: ::prost::alloc::string::String,
    /// (Optional) Public key for encrypted messaging
    #[prost(string, tag="5")]
    pub message_key: ::prost::alloc::string::String,
    /// (Optional) Transfer rate for issued currencies (1e9 = 100%)
    #[prost(uint32, tag="6")]
    pub transfer_rate: u32,
    /// (Optional) Tick size for offers
    #[prost(uint32, tag="7")]
    pub tick_size: u32,
    /// (Optional) NFT minter account
    #[prost(string, tag="8")]
    pub nftoken_minter: ::prost::alloc::string::String,
    /// (Optional) Arbitrary 256-bit value stored with the account
    #[prost(string, tag="9")]
    pub wallet_locator: ::prost::alloc::string::String,
    /// (Optional) Not used - valid but has no effect
    #[prost(uint32, tag="10")]
    pub wallet_size: u32,
}
/// AccountDelete - Deletes an account
/// Reference: <https://xrpl.org/accountdelete.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AccountDelete {
    /// Destination for remaining XRP
    #[prost(string, tag="1")]
    pub destination: ::prost::alloc::string::String,
    /// (Optional) Destination tag
    #[prost(uint32, tag="2")]
    pub destination_tag: u32,
    /// (Optional) Set of Credentials to authorize deposit (array of ledger entry IDs)
    #[prost(string, repeated, tag="3")]
    pub credential_ids: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
}
/// SetRegularKey - Sets or clears an account's regular key
/// Reference: <https://xrpl.org/setregularkey.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SetRegularKey {
    /// Regular key to set (omit to remove)
    #[prost(string, tag="1")]
    pub regular_key: ::prost::alloc::string::String,
}
/// SignerListSet - Modifies multi-signing settings
/// Reference: <https://xrpl.org/signerlistset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SignerListSet {
    /// Quorum required for multi-signing
    #[prost(uint32, tag="1")]
    pub signer_quorum: u32,
    /// List of signers
    #[prost(message, repeated, tag="2")]
    pub signer_entries: ::prost::alloc::vec::Vec<SignerEntry>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SignerEntry {
    /// XRP Ledger address whose signature contributes to multi-signature
    #[prost(string, tag="1")]
    pub account: ::prost::alloc::string::String,
    /// Weight of a signature from this signer (UInt16)
    #[prost(uint32, tag="2")]
    pub signer_weight: u32,
    /// (Optional) Arbitrary hexadecimal data to identify the signer
    #[prost(string, tag="3")]
    pub wallet_locator: ::prost::alloc::string::String,
}
/// EscrowCreate - Creates a held payment
/// Reference: <https://xrpl.org/escrowcreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct EscrowCreate {
    /// Amount to escrow
    #[prost(message, optional, tag="1")]
    pub amount: ::core::option::Option<Amount>,
    /// Recipient of escrowed funds
    #[prost(string, tag="2")]
    pub destination: ::prost::alloc::string::String,
    /// (Optional) Time after which escrow can be cancelled
    #[prost(uint32, tag="3")]
    pub cancel_after: u32,
    /// (Optional) Time after which escrow can be finished
    #[prost(uint32, tag="4")]
    pub finish_after: u32,
    /// (Optional) Crypto-condition that must be fulfilled (hex)
    #[prost(string, tag="5")]
    pub condition: ::prost::alloc::string::String,
    /// (Optional) Destination tag
    #[prost(uint32, tag="6")]
    pub destination_tag: u32,
}
/// EscrowFinish - Completes a held payment
/// Reference: <https://xrpl.org/escrowfinish.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct EscrowFinish {
    /// Owner of the escrow
    #[prost(string, tag="1")]
    pub owner: ::prost::alloc::string::String,
    /// Sequence of EscrowCreate transaction
    #[prost(uint32, tag="2")]
    pub offer_sequence: u32,
    /// (Optional) Crypto-condition (hex)
    #[prost(string, tag="3")]
    pub condition: ::prost::alloc::string::String,
    /// (Optional) Fulfillment for condition (hex)
    #[prost(string, tag="4")]
    pub fulfillment: ::prost::alloc::string::String,
    /// (Optional) Set of Credentials to authorize deposit (array of ledger entry IDs)
    #[prost(string, repeated, tag="5")]
    pub credential_ids: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
}
/// EscrowCancel - Cancels a held payment
/// Reference: <https://xrpl.org/escrowcancel.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct EscrowCancel {
    /// Owner of the escrow
    #[prost(string, tag="1")]
    pub owner: ::prost::alloc::string::String,
    /// Sequence of EscrowCreate transaction
    #[prost(uint32, tag="2")]
    pub offer_sequence: u32,
}
/// NFTokenMint - Mints a new NFT
/// Reference: <https://xrpl.org/nftokenmint.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct NfTokenMint {
    /// Taxon for this NFT (issuer-defined category)
    #[prost(uint32, tag="1")]
    pub nftoken_taxon: u32,
    /// (Optional) Issuer if minting on behalf of another
    #[prost(string, tag="2")]
    pub issuer: ::prost::alloc::string::String,
    /// (Optional) Transfer fee (0-50000, representing 0-50%)
    #[prost(uint32, tag="3")]
    pub transfer_fee: u32,
    /// (Optional) URI pointing to token metadata (hex encoded, up to 256 bytes)
    #[prost(string, tag="4")]
    pub uri: ::prost::alloc::string::String,
    /// (Optional) Amount expected or offered for the NFToken
    #[prost(message, optional, tag="5")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Time after which the offer is no longer active
    #[prost(uint32, tag="6")]
    pub expiration: u32,
    /// (Optional) Account that may accept this offer
    #[prost(string, tag="7")]
    pub destination: ::prost::alloc::string::String,
    /// (Optional) Transaction flags
    /// tfBurnable = 1 (0x00000001) - Allow issuer to destroy the NFToken
    /// tfOnlyXRP = 2 (0x00000002) - NFToken can only be bought/sold for XRP
    /// tfTrustLine = 4 (0x00000004) - DEPRECATED: Auto-create trust lines for fees
    /// tfTransferable = 8 (0x00000008) - NFToken can be transferred to others
    /// tfMutable = 16 (0x00000010) - URI can be updated via NFTokenModify
    #[prost(uint32, tag="8")]
    pub flags: u32,
}
/// NFTokenBurn - Burns an existing NFT
/// Reference: <https://xrpl.org/nftokenburn.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct NfTokenBurn {
    /// ID of the NFT to burn (64 hex chars)
    #[prost(string, tag="1")]
    pub nftoken_id: ::prost::alloc::string::String,
    /// (Optional) Owner if burning on behalf of another
    #[prost(string, tag="2")]
    pub owner: ::prost::alloc::string::String,
}
/// NFTokenCreateOffer - Creates an offer to buy or sell an NFT
/// Reference: <https://xrpl.org/nftokencreateoffer.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct NfTokenCreateOffer {
    /// ID of the NFT
    #[prost(string, tag="1")]
    pub nftoken_id: ::prost::alloc::string::String,
    /// Amount offered (0 for free transfer)
    #[prost(message, optional, tag="2")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) For buy offers, the NFT owner
    #[prost(string, tag="3")]
    pub owner: ::prost::alloc::string::String,
    /// (Optional) Specific account that can accept
    #[prost(string, tag="4")]
    pub destination: ::prost::alloc::string::String,
    /// (Optional) Expiration time
    #[prost(uint32, tag="5")]
    pub expiration: u32,
    /// (Optional) Transaction flags
    /// tfSellNFToken = 1 (0x00000001) - If set indicate this is a sell offer.
    #[prost(uint32, tag="6")]
    pub flags: u32,
}
/// NFTokenCancelOffer - Cancels NFT offers
/// Reference: <https://xrpl.org/nftokencanceloffer.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct NfTokenCancelOffer {
    /// List of offer IDs to cancel
    #[prost(string, repeated, tag="1")]
    pub nftoken_offers: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
}
/// NFTokenAcceptOffer - Accepts an NFT offer
/// Reference: <https://xrpl.org/nftokenacceptoffer.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct NfTokenAcceptOffer {
    /// (Optional) Sell offer to accept
    #[prost(string, tag="1")]
    pub nftoken_sell_offer: ::prost::alloc::string::String,
    /// (Optional) Buy offer to accept
    #[prost(string, tag="2")]
    pub nftoken_buy_offer: ::prost::alloc::string::String,
    /// (Optional) Broker fee for brokered trades
    #[prost(message, optional, tag="3")]
    pub nftoken_broker_fee: ::core::option::Option<Amount>,
}
/// NFTokenModify - Modifies the URI of a dynamic NFT
/// Reference: <https://xrpl.org/nftokenmodify.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct NfTokenModify {
    /// The unique identifier of the NFT to modify
    #[prost(string, tag="1")]
    pub nftoken_id: ::prost::alloc::string::String,
    /// (Optional) Owner of the NFT (omit if Account is the owner)
    #[prost(string, tag="2")]
    pub owner: ::prost::alloc::string::String,
    /// (Optional) New URI for the NFT (hex encoded, up to 256 bytes)
    /// If omitted, the existing URI is deleted
    #[prost(string, tag="3")]
    pub uri: ::prost::alloc::string::String,
}
/// PaymentChannelCreate - Creates a new unidirectional XRP payment channel
/// Reference:
/// <https://xrpl.org/docs/references/protocol/transactions/types/paymentchannelcreate>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PaymentChannelCreate {
    /// Recipient of funds from channel
    #[prost(string, tag="1")]
    pub destination: ::prost::alloc::string::String,
    /// Amount of XRP to set aside for this channel
    #[prost(message, optional, tag="2")]
    pub amount: ::core::option::Option<Amount>,
    /// Time in seconds to wait after close request before channel closes
    #[prost(uint32, tag="3")]
    pub settle_delay: u32,
    /// Public key for signing claims (hex)
    #[prost(string, tag="4")]
    pub public_key: ::prost::alloc::string::String,
    /// (Optional) Time after which channel can be closed
    #[prost(uint32, tag="5")]
    pub cancel_after: u32,
    /// (Optional) Destination tag
    #[prost(uint32, tag="6")]
    pub destination_tag: u32,
}
/// PaymentChannelFund - Adds XRP to an existing payment channel
/// Reference:
/// <https://xrpl.org/docs/references/protocol/transactions/types/paymentchannelfund>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PaymentChannelFund {
    /// Channel ID (64 hex chars)
    #[prost(string, tag="1")]
    pub channel: ::prost::alloc::string::String,
    /// Amount to add to the channel
    #[prost(message, optional, tag="2")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) New expiration for the channel
    #[prost(uint32, tag="3")]
    pub expiration: u32,
}
/// PaymentChannelClaim - Claims XRP from a payment channel
/// Reference:
/// <https://xrpl.org/docs/references/protocol/transactions/types/paymentchannelclaim>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PaymentChannelClaim {
    /// Channel ID (64 hex chars)
    #[prost(string, tag="1")]
    pub channel: ::prost::alloc::string::String,
    /// (Optional) Amount of XRP authorized by signature (cumulative)
    /// Required except when closing the channel
    #[prost(message, optional, tag="2")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Total amount delivered by this channel after processing claim
    /// Required to deliver XRP
    #[prost(message, optional, tag="3")]
    pub balance: ::core::option::Option<Amount>,
    /// (Optional) Signature authorizing claim (hex)
    /// Required unless sender is source address of channel
    #[prost(string, tag="4")]
    pub signature: ::prost::alloc::string::String,
    /// (Optional) Public key of signature (hex)
    /// Required unless sender is source address and Signature is omitted
    #[prost(string, tag="5")]
    pub public_key: ::prost::alloc::string::String,
    /// (Optional) Set of Credentials to authorize deposit (array of ledger entry IDs)
    #[prost(string, repeated, tag="6")]
    pub credential_ids: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    /// (Optional) Transaction flags
    /// tfRenew = 65536 (0x00010000) - Clear the channel's Expiration time
    /// tfClose = 131072 (0x00020000) - Request to close the channel
    #[prost(uint32, tag="7")]
    pub flags: u32,
}
/// CheckCreate - Creates a Check object
/// Reference: <https://xrpl.org/checkcreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CheckCreate {
    /// Recipient of the check
    #[prost(string, tag="1")]
    pub destination: ::prost::alloc::string::String,
    /// Maximum amount the check can debit
    #[prost(message, optional, tag="2")]
    pub send_max: ::core::option::Option<Amount>,
    /// (Optional) Expiration time
    #[prost(uint32, tag="3")]
    pub expiration: u32,
    /// (Optional) Destination tag
    #[prost(uint32, tag="4")]
    pub destination_tag: u32,
    /// (Optional) Invoice ID for reference
    #[prost(string, tag="5")]
    pub invoice_id: ::prost::alloc::string::String,
}
/// CheckCash - Cashes a Check object
/// Reference: <https://xrpl.org/checkcash.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CheckCash {
    /// ID of the check to cash (64 hex chars)
    #[prost(string, tag="1")]
    pub check_id: ::prost::alloc::string::String,
    /// (Optional) Exact amount to receive
    #[prost(message, optional, tag="2")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Minimum amount willing to receive
    #[prost(message, optional, tag="3")]
    pub deliver_min: ::core::option::Option<Amount>,
}
/// CheckCancel - Cancels a Check object
/// Reference: <https://xrpl.org/checkcancel.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CheckCancel {
    /// ID of the check to cancel (64 hex chars)
    #[prost(string, tag="1")]
    pub check_id: ::prost::alloc::string::String,
}
/// DepositPreauth - Pre-authorizes an account to deliver payments
/// Reference: <https://xrpl.org/depositpreauth.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DepositPreauth {
    /// (Optional) Account to pre-authorize
    #[prost(string, tag="1")]
    pub authorize: ::prost::alloc::string::String,
    /// (Optional) Account to remove pre-authorization from
    #[prost(string, tag="2")]
    pub unauthorize: ::prost::alloc::string::String,
    /// (Optional) Credentials to authorize
    #[prost(message, repeated, tag="3")]
    pub authorize_credentials: ::prost::alloc::vec::Vec<AuthorizeCredential>,
    /// (Optional) Credentials to unauthorize
    #[prost(message, repeated, tag="4")]
    pub unauthorize_credentials: ::prost::alloc::vec::Vec<AuthorizeCredential>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AuthorizeCredential {
    #[prost(string, tag="1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub credential_type: ::prost::alloc::string::String,
}
/// TicketCreate - Creates Ticket objects for future transactions
/// Reference: <https://xrpl.org/ticketcreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TicketCreate {
    /// Number of tickets to create (1-250)
    #[prost(uint32, tag="1")]
    pub ticket_count: u32,
}
/// Clawback - Claws back issued tokens from a holder
/// Reference: <https://xrpl.org/clawback.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Clawback {
    /// Amount to claw back (includes holder's address in issuer field)
    #[prost(message, optional, tag="1")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Holder account for MPT clawback
    #[prost(string, tag="2")]
    pub holder: ::prost::alloc::string::String,
}
/// AMMCreate - Creates an Automated Market Maker instance
/// Reference: <https://xrpl.org/ammcreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmCreate {
    /// First asset to deposit
    #[prost(message, optional, tag="1")]
    pub amount: ::core::option::Option<Amount>,
    /// Second asset to deposit
    #[prost(message, optional, tag="2")]
    pub amount2: ::core::option::Option<Amount>,
    /// Trading fee (0-1000, representing 0-1%)
    #[prost(uint32, tag="3")]
    pub trading_fee: u32,
}
/// AMMDeposit - Deposits assets into an AMM
/// Reference: <https://xrpl.org/ammdeposit.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmDeposit {
    /// First asset identifier
    #[prost(message, optional, tag="1")]
    pub asset: ::core::option::Option<Asset>,
    /// Second asset identifier
    #[prost(message, optional, tag="2")]
    pub asset2: ::core::option::Option<Asset>,
    /// (Optional) Amount of first asset to deposit
    #[prost(message, optional, tag="3")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Amount of second asset to deposit
    #[prost(message, optional, tag="4")]
    pub amount2: ::core::option::Option<Amount>,
    /// (Optional) Effective price for single-asset deposit
    #[prost(message, optional, tag="5")]
    pub e_price: ::core::option::Option<Amount>,
    /// (Optional) LP tokens to receive
    #[prost(message, optional, tag="6")]
    pub lp_token_out: ::core::option::Option<Amount>,
    /// (Optional) Trading fee for the AMM
    #[prost(uint32, tag="7")]
    pub trading_fee: u32,
    /// (Optional) Transaction flags for deposit mode
    /// tfLPToken = 65536 (0x00010000) - Double-asset deposit for specified LP tokens
    /// tfSingleAsset = 524288 (0x00080000) - Single-asset deposit
    /// tfTwoAsset = 1048576 (0x00100000) - Double-asset deposit with specified amounts
    /// tfOneAssetLPToken = 2097152 (0x00200000) - Single-asset deposit for specified LP tokens
    /// tfLimitLPToken = 4194304 (0x00400000) - Single-asset deposit with price limit
    /// tfTwoAssetIfEmpty = 8388608 (0x00800000) - Special deposit to empty AMM
    #[prost(uint32, tag="8")]
    pub flags: u32,
}
/// AMMWithdraw - Withdraws assets from an AMM
/// Reference: <https://xrpl.org/ammwithdraw.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmWithdraw {
    /// First asset identifier
    #[prost(message, optional, tag="1")]
    pub asset: ::core::option::Option<Asset>,
    /// Second asset identifier
    #[prost(message, optional, tag="2")]
    pub asset2: ::core::option::Option<Asset>,
    /// (Optional) Amount of first asset to withdraw
    #[prost(message, optional, tag="3")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Amount of second asset to withdraw
    #[prost(message, optional, tag="4")]
    pub amount2: ::core::option::Option<Amount>,
    /// (Optional) Effective price for single-asset withdrawal
    #[prost(message, optional, tag="5")]
    pub e_price: ::core::option::Option<Amount>,
    /// (Optional) LP tokens to burn
    #[prost(message, optional, tag="6")]
    pub lp_token_in: ::core::option::Option<Amount>,
    /// (Optional) Transaction flags for withdrawal mode
    /// tfLPToken = 65536 (0x00010000) - Double-asset withdrawal for specified LP tokens
    /// tfWithdrawAll = 131072 (0x00020000) - Withdraw all LP tokens (double-asset)
    /// tfOneAssetWithdrawAll = 262144 (0x00040000) - Withdraw all LP tokens (single-asset)
    /// tfSingleAsset = 524288 (0x00080000) - Single-asset withdrawal
    /// tfTwoAsset = 1048576 (0x00100000) - Double-asset withdrawal with specified amounts
    /// tfOneAssetLPToken = 2097152 (0x00200000) - Single-asset withdrawal for specified LP tokens
    /// tfLimitLPToken = 4194304 (0x00400000) - Single-asset withdrawal with price limit
    #[prost(uint32, tag="7")]
    pub flags: u32,
}
/// AMMVote - Votes on the trading fee for an AMM
/// Reference: <https://xrpl.org/ammvote.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmVote {
    /// First asset identifier
    #[prost(message, optional, tag="1")]
    pub asset: ::core::option::Option<Asset>,
    /// Second asset identifier
    #[prost(message, optional, tag="2")]
    pub asset2: ::core::option::Option<Asset>,
    /// Proposed trading fee (0-1000)
    #[prost(uint32, tag="3")]
    pub trading_fee: u32,
}
/// AMMBid - Bids on the auction slot of an AMM
/// Reference: <https://xrpl.org/ammbid.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmBid {
    /// First asset identifier
    #[prost(message, optional, tag="1")]
    pub asset: ::core::option::Option<Asset>,
    /// Second asset identifier
    #[prost(message, optional, tag="2")]
    pub asset2: ::core::option::Option<Asset>,
    /// (Optional) Minimum bid in LP tokens
    #[prost(message, optional, tag="3")]
    pub bid_min: ::core::option::Option<Amount>,
    /// (Optional) Maximum bid in LP tokens
    #[prost(message, optional, tag="4")]
    pub bid_max: ::core::option::Option<Amount>,
    /// (Optional) Accounts authorized to trade at discounted fee
    #[prost(message, repeated, tag="5")]
    pub auth_accounts: ::prost::alloc::vec::Vec<AuthAccount>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AuthAccount {
    #[prost(string, tag="1")]
    pub account: ::prost::alloc::string::String,
}
/// AMMDelete - Deletes an empty AMM instance
/// Reference: <https://xrpl.org/ammdelete.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmDelete {
    /// First asset identifier
    #[prost(message, optional, tag="1")]
    pub asset: ::core::option::Option<Asset>,
    /// Second asset identifier
    #[prost(message, optional, tag="2")]
    pub asset2: ::core::option::Option<Asset>,
}
/// AMMClawback - Claws back tokens from an AMM pool
/// Reference: <https://xrpl.org/ammclawback.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AmmClawback {
    /// Holder of the LP tokens
    #[prost(string, tag="1")]
    pub holder: ::prost::alloc::string::String,
    /// First asset identifier
    #[prost(message, optional, tag="2")]
    pub asset: ::core::option::Option<Asset>,
    /// Second asset identifier
    #[prost(message, optional, tag="3")]
    pub asset2: ::core::option::Option<Asset>,
    /// (Optional) Amount to claw back
    #[prost(message, optional, tag="4")]
    pub amount: ::core::option::Option<Amount>,
    /// (Optional) Transaction flags
    /// tfClawTwoAssets = 1 (0x00000001) - Claw back both assets proportionally
    #[prost(uint32, tag="5")]
    pub flags: u32,
}
/// DIDSet - Creates or updates a DID (Decentralized Identifier)
/// Reference: <https://xrpl.org/didset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DidSet {
    /// (Optional) DID document (hex)
    #[prost(string, tag="1")]
    pub did_document: ::prost::alloc::string::String,
    /// (Optional) URI for the DID
    #[prost(string, tag="2")]
    pub uri: ::prost::alloc::string::String,
    /// (Optional) Data field (hex)
    #[prost(string, tag="3")]
    pub data: ::prost::alloc::string::String,
}
/// DIDDelete - Deletes a DID
/// Reference: <https://xrpl.org/diddelete.html>
///
/// No fields - deletes sender's DID
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DidDelete {
}
/// OracleSet - Creates or updates a price oracle
/// Reference: <https://xrpl.org/oracleset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct OracleSet {
    /// Unique identifier for this oracle
    #[prost(uint32, tag="1")]
    pub oracle_document_id: u32,
    /// (Optional) Provider name (hex)
    #[prost(string, tag="2")]
    pub provider: ::prost::alloc::string::String,
    /// (Optional) URI for oracle data
    #[prost(string, tag="3")]
    pub uri: ::prost::alloc::string::String,
    /// (Optional) Asset class (hex)
    #[prost(string, tag="4")]
    pub asset_class: ::prost::alloc::string::String,
    /// Time of last update (Ripple epoch)
    #[prost(uint32, tag="5")]
    pub last_update_time: u32,
    /// Price data series
    #[prost(message, repeated, tag="6")]
    pub price_data_series: ::prost::alloc::vec::Vec<PriceData>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PriceData {
    /// Base asset
    #[prost(string, tag="1")]
    pub base_asset: ::prost::alloc::string::String,
    /// Quote asset
    #[prost(string, tag="2")]
    pub quote_asset: ::prost::alloc::string::String,
    /// (Optional) Asset price
    #[prost(uint64, tag="3")]
    pub asset_price: u64,
    /// (Optional) Scale factor
    #[prost(uint32, tag="4")]
    pub scale: u32,
}
/// OracleDelete - Deletes a price oracle
/// Reference: <https://xrpl.org/oracledelete.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct OracleDelete {
    /// Unique identifier of oracle to delete
    #[prost(uint32, tag="1")]
    pub oracle_document_id: u32,
}
/// MPTokenIssuanceCreate - Creates a Multi-Purpose Token issuance
/// Reference: <https://xrpl.org/mptokenissuancecreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct MpTokenIssuanceCreate {
    /// (Optional) Decimal scale of the token
    #[prost(uint32, tag="1")]
    pub asset_scale: u32,
    /// (Optional) Transfer fee (0-50000, 0-50%)
    #[prost(uint32, tag="2")]
    pub transfer_fee: u32,
    /// (Optional) Maximum token supply
    #[prost(uint64, tag="3")]
    pub maximum_amount: u64,
    /// (Optional) Metadata for the token (hex)
    #[prost(string, tag="4")]
    pub mptoken_metadata: ::prost::alloc::string::String,
    /// (Optional) Transaction flags
    /// tfMPTCanLock = 2 (0x00000002) - MPT can be locked individually and globally
    /// tfMPTRequireAuth = 4 (0x00000004) - Individual holders must be authorized
    /// tfMPTCanEscrow = 8 (0x00000008) - Holders can place balances into escrow
    /// tfMPTCanTrade = 16 (0x00000010) - Holders can trade balances using DEX
    /// tfMPTCanTransfer = 32 (0x00000020) - Tokens can be transferred to non-issuers
    /// tfMPTCanClawback = 64 (0x00000040) - Issuer can claw back value from holders
    #[prost(uint32, tag="5")]
    pub flags: u32,
}
/// MPTokenIssuanceDestroy - Destroys an MPToken issuance
/// Reference: <https://xrpl.org/mptokenissuancedestroy.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct MpTokenIssuanceDestroy {
    /// ID of the issuance to destroy (64 hex chars)
    #[prost(string, tag="1")]
    pub mptoken_issuance_id: ::prost::alloc::string::String,
}
/// MPTokenIssuanceSet - Sets properties on an MPToken issuance or holder
/// Reference: <https://xrpl.org/mptokenissuanceset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct MpTokenIssuanceSet {
    /// ID of the issuance
    #[prost(string, tag="1")]
    pub mptoken_issuance_id: ::prost::alloc::string::String,
    /// (Optional) Holder to modify
    #[prost(string, tag="2")]
    pub holder: ::prost::alloc::string::String,
    /// (Optional) Transaction flags
    /// tfMPTLock = 1 (0x00000001) - Lock balances of this MPT issuance
    /// tfMPTUnlock = 2 (0x00000002) - Unlock balances of this MPT issuance
    #[prost(uint32, tag="3")]
    pub flags: u32,
}
/// MPTokenAuthorize - Authorizes an account to hold MPTokens
/// Reference: <https://xrpl.org/mptokenauthorize.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct MpTokenAuthorize {
    /// ID of the issuance to authorize
    #[prost(string, tag="1")]
    pub mptoken_issuance_id: ::prost::alloc::string::String,
    /// (Optional) Holder to authorize (issuer-side)
    #[prost(string, tag="2")]
    pub holder: ::prost::alloc::string::String,
    /// (Optional) Transaction flags
    /// tfMPTUnauthorize = 1 (0x00000001) - Revoke authorization/willingness to hold MPT
    #[prost(uint32, tag="3")]
    pub flags: u32,
}
/// CredentialCreate - Creates a verifiable credential
/// Reference: <https://xrpl.org/credentialcreate.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialCreate {
    /// Subject of the credential
    #[prost(string, tag="1")]
    pub subject: ::prost::alloc::string::String,
    /// Type of credential (hex)
    #[prost(string, tag="2")]
    pub credential_type: ::prost::alloc::string::String,
    /// (Optional) Expiration time
    #[prost(uint32, tag="3")]
    pub expiration: u32,
    /// (Optional) URI for credential data
    #[prost(string, tag="4")]
    pub uri: ::prost::alloc::string::String,
}
/// CredentialAccept - Accepts a credential
/// Reference: <https://xrpl.org/credentialaccept.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialAccept {
    /// Issuer of the credential
    #[prost(string, tag="1")]
    pub issuer: ::prost::alloc::string::String,
    /// Type of credential (hex)
    #[prost(string, tag="2")]
    pub credential_type: ::prost::alloc::string::String,
}
/// CredentialDelete - Deletes a credential
/// Reference: <https://xrpl.org/credentialdelete.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialDelete {
    /// (Optional) Subject of the credential
    #[prost(string, tag="1")]
    pub subject: ::prost::alloc::string::String,
    /// (Optional) Issuer of the credential
    #[prost(string, tag="2")]
    pub issuer: ::prost::alloc::string::String,
    /// Type of credential (hex)
    #[prost(string, tag="3")]
    pub credential_type: ::prost::alloc::string::String,
}
/// PermissionedDomainSet - Creates or modifies a permissioned domain
/// Reference: <https://xrpl.org/permissioneddomainset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PermissionedDomainSet {
    /// (Optional) Domain ID to modify (omit to create new)
    #[prost(string, tag="1")]
    pub domain_id: ::prost::alloc::string::String,
    /// Accepted credential types
    #[prost(message, repeated, tag="2")]
    pub accepted_credentials: ::prost::alloc::vec::Vec<AcceptedCredential>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AcceptedCredential {
    #[prost(string, tag="1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub credential_type: ::prost::alloc::string::String,
}
/// PermissionedDomainDelete - Deletes a permissioned domain
/// Reference: <https://xrpl.org/permissioneddomaindelete.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PermissionedDomainDelete {
    /// Domain ID to delete
    #[prost(string, tag="1")]
    pub domain_id: ::prost::alloc::string::String,
}
/// DelegateSet - Delegates permissions to another account
/// Reference: <https://xrpl.org/delegateset.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DelegateSet {
    /// Account to delegate permissions to
    #[prost(string, tag="1")]
    pub authorize: ::prost::alloc::string::String,
    /// List of permissions to delegate
    #[prost(message, repeated, tag="2")]
    pub permissions: ::prost::alloc::vec::Vec<Permission>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Permission {
    /// Permission type
    #[prost(uint32, tag="1")]
    pub permission_type: u32,
    /// (Optional) Permission value
    #[prost(string, tag="2")]
    pub permission_value: ::prost::alloc::string::String,
}
/// Batch - Submit multiple transactions atomically
/// Reference: <https://xrpl.org/batch.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Batch {
    /// List of raw transactions to execute (minimum 2, maximum 8)
    #[prost(message, repeated, tag="1")]
    pub raw_transactions: ::prost::alloc::vec::Vec<RawTransaction>,
    /// (Optional) Signatures for multi-account batch transactions
    #[prost(message, repeated, tag="2")]
    pub batch_signers: ::prost::alloc::vec::Vec<BatchSigner>,
    /// Transaction flags for batch execution mode (required)
    /// tfAllOrNothing = 65536 (0x00010000) - All transactions must succeed or
    /// batch fails tfOnlyOne = 131072 (0x00020000) - Only first successful
    /// transaction is applied tfUntilFailure = 262144 (0x00040000) - Apply until
    /// first failure, skip rest tfIndependent = 524288 (0x00080000) - Apply all
    /// transactions regardless of failure
    #[prost(uint32, tag="3")]
    pub flags: u32,
}
/// RawTransaction - Inner transaction within a batch
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RawTransaction {
    /// The serialized transaction data (JSON encoded)
    /// Must have tfInnerBatchTxn flag (1073741824 / 0x40000000)
    /// Must have Fee = "0"
    /// Must have SigningPubKey = ""
    /// Must not have TxnSignature
    #[prost(bytes="vec", tag="1")]
    pub raw_transaction: ::prost::alloc::vec::Vec<u8>,
}
/// BatchSigner - Signature for an account in multi-account batch
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct BatchSigner {
    /// Account with at least one inner transaction
    #[prost(string, tag="1")]
    pub account: ::prost::alloc::string::String,
    /// (Optional) Hex representation of public key
    #[prost(string, tag="2")]
    pub signing_pub_key: ::prost::alloc::string::String,
    /// (Optional) Signature from this account
    #[prost(string, tag="3")]
    pub txn_signature: ::prost::alloc::string::String,
    /// (Optional) Multi-signature array (alternative to single signature)
    #[prost(message, repeated, tag="4")]
    pub signers: ::prost::alloc::vec::Vec<Signer>,
}
/// EnableAmendment - System transaction to enable/modify amendments
/// Reference: <https://xrpl.org/enableamendment.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct EnableAmendment {
    /// Ledger sequence when this applies
    #[prost(uint32, tag="1")]
    pub ledger_sequence: u32,
    /// Amendment hash (64 hex chars)
    #[prost(string, tag="2")]
    pub amendment: ::prost::alloc::string::String,
}
/// SetFee - System transaction to update network fees
/// Reference: <https://xrpl.org/setfee.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SetFee {
    /// (Optional) Ledger sequence when this applies
    #[prost(uint32, tag="1")]
    pub ledger_sequence: u32,
    /// Old format fields
    #[prost(uint64, tag="2")]
    pub base_fee: u64,
    #[prost(uint32, tag="3")]
    pub reference_fee_units: u32,
    #[prost(uint32, tag="4")]
    pub reserve_base: u32,
    #[prost(uint32, tag="5")]
    pub reserve_increment: u32,
    /// New format fields (drops)
    #[prost(message, optional, tag="6")]
    pub base_fee_drops: ::core::option::Option<Amount>,
    #[prost(message, optional, tag="7")]
    pub reserve_base_drops: ::core::option::Option<Amount>,
    #[prost(message, optional, tag="8")]
    pub reserve_increment_drops: ::core::option::Option<Amount>,
    /// Smart contract related
    #[prost(uint64, tag="9")]
    pub extension_compute_limit: u64,
    #[prost(uint64, tag="10")]
    pub extension_size_limit: u64,
    #[prost(uint64, tag="11")]
    pub gas_price: u64,
}
/// UNLModify - System transaction to modify the Unique Node List
/// Reference: <https://xrpl.org/unlmodify.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UnlModify {
    /// Whether this disables a validator
    #[prost(bool, tag="1")]
    pub unl_modify_disabling: bool,
    /// Ledger sequence when this applies
    #[prost(uint32, tag="2")]
    pub ledger_sequence: u32,
    /// Validator public key being modified (hex)
    #[prost(string, tag="3")]
    pub unl_modify_validator: ::prost::alloc::string::String,
}
/// LedgerStateFix - System transaction to fix ledger state issues
/// Reference: <https://xrpl.org/ledgerstatefix.html>
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct LedgerStateFix {
    /// Type of fix to apply
    #[prost(uint32, tag="1")]
    pub ledger_fix_type: u32,
    /// (Optional) Owner account affected
    #[prost(string, tag="2")]
    pub owner: ::prost::alloc::string::String,
}
/// Block represents an XRPL validated ledger
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Block {
    /// Ledger sequence number (ledger_index)
    #[prost(uint64, tag="1")]
    pub number: u64,
    /// Ledger hash (32 bytes)
    #[prost(bytes="vec", tag="2")]
    pub hash: ::prost::alloc::vec::Vec<u8>,
    /// Ledger header information
    #[prost(message, optional, tag="3")]
    pub header: ::core::option::Option<Header>,
    /// Schema version for this protobuf
    #[prost(int64, tag="4")]
    pub version: i64,
    /// Transactions in this ledger
    #[prost(message, repeated, tag="5")]
    pub transactions: ::prost::alloc::vec::Vec<Transaction>,
    /// Ledger close time
    #[prost(message, optional, tag="6")]
    pub close_time: ::core::option::Option<::prost_types::Timestamp>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Header {
    /// Parent ledger hash
    #[prost(bytes="vec", tag="1")]
    pub parent_hash: ::prost::alloc::vec::Vec<u8>,
    /// Total XRP in drops (int64 for 10^17 max)
    #[prost(int64, tag="2")]
    pub total_drops: i64,
    /// Account state hash (state tree root)
    #[prost(bytes="vec", tag="3")]
    pub account_hash: ::prost::alloc::vec::Vec<u8>,
    /// Transaction tree hash
    #[prost(bytes="vec", tag="4")]
    pub transaction_hash: ::prost::alloc::vec::Vec<u8>,
    /// Close time resolution in seconds
    #[prost(uint32, tag="5")]
    pub close_time_resolution: u32,
    /// Close flags
    #[prost(uint32, tag="6")]
    pub close_flags: u32,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Transaction {
    /// Transaction hash (32 bytes)
    #[prost(bytes="vec", tag="1")]
    pub hash: ::prost::alloc::vec::Vec<u8>,
    /// Transaction result code (e.g., "tesSUCCESS", "tecPATH_DRY", "temMALFORMED")
    /// Future-proof: supports any result code XRPL adds without schema updates
    #[prost(string, tag="2")]
    pub result: ::prost::alloc::string::String,
    /// Position in ledger (0-indexed)
    #[prost(uint32, tag="3")]
    pub index: u32,
    /// Raw transaction blob (XRPL binary format)
    /// Kept for backward compatibility and advanced decoding
    #[prost(bytes="vec", tag="4")]
    pub tx_blob: ::prost::alloc::vec::Vec<u8>,
    /// Transaction metadata blob (XRPL binary format)
    /// Contains: AffectedNodes, delivered_amount, etc.
    #[prost(bytes="vec", tag="5")]
    pub meta_blob: ::prost::alloc::vec::Vec<u8>,
    /// Transaction type string (e.g., "Payment", "OfferCreate", "NFTokenMint")
    /// Future-proof: supports any transaction type XRPL adds without schema
    /// updates
    #[prost(string, tag="6")]
    pub tx_type: ::prost::alloc::string::String,
    /// Account that initiated this transaction
    #[prost(string, tag="7")]
    pub account: ::prost::alloc::string::String,
    /// Fee paid in drops
    #[prost(uint64, tag="8")]
    pub fee: u64,
    /// Transaction sequence number
    #[prost(uint32, tag="9")]
    pub sequence: u32,
    /// Hash value identifying another transaction. If provided, this transaction
    /// is only valid if the sending account's previously-sent transaction matches
    /// the provided hash.
    #[prost(string, tag="10")]
    pub account_txn_id: ::prost::alloc::string::String,
    /// Delegate account that is sending the transaction on behalf of the Account
    #[prost(string, tag="11")]
    pub delegate: ::prost::alloc::string::String,
    /// Set of bit-flags for this transaction
    #[prost(uint32, tag="12")]
    pub flags: u32,
    /// Highest ledger index this transaction can appear in
    #[prost(uint32, tag="13")]
    pub last_ledger_sequence: u32,
    /// Additional arbitrary information attached to this transaction
    #[prost(message, repeated, tag="14")]
    pub memos: ::prost::alloc::vec::Vec<Memo>,
    /// Network ID of the chain this transaction is intended for
    /// Required for networks with ID >= 1025, disallowed for ID <= 1024
    #[prost(uint32, tag="15")]
    pub network_id: u32,
    /// Multi-signature data (for multi-signed transactions)
    #[prost(message, repeated, tag="16")]
    pub signers: ::prost::alloc::vec::Vec<Signer>,
    /// Arbitrary integer used to identify the reason for this payment
    #[prost(uint32, tag="17")]
    pub source_tag: u32,
    /// Public key that corresponds to the private key used to sign this
    /// transaction Empty string indicates a multi-signature is present in the
    /// signers field
    #[prost(string, tag="18")]
    pub signing_pub_key: ::prost::alloc::string::String,
    /// Sequence number of the ticket to use in place of a Sequence number
    /// If provided, Sequence must be 0
    #[prost(uint32, tag="19")]
    pub ticket_sequence: u32,
    /// Signature that verifies this transaction as originating from the account
    #[prost(string, tag="20")]
    pub txn_signature: ::prost::alloc::string::String,
    /// Decoded transaction details based on tx_type
    #[prost(oneof="transaction::TxDetails", tags="30, 40, 41, 50, 60, 61, 62, 63, 70, 71, 72, 80, 81, 82, 90, 91, 92, 100, 101, 110, 111, 112, 113, 114, 115, 120, 130, 131, 132, 133, 134, 135, 136, 140, 141, 150, 151, 160, 161, 162, 163, 170, 171, 172, 180, 181, 190, 200, 900, 901, 902, 903")]
    pub tx_details: ::core::option::Option<transaction::TxDetails>,
}
/// Nested message and enum types in `Transaction`.
pub mod transaction {
    /// Decoded transaction details based on tx_type
    #[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum TxDetails {
        /// Payment transactions
        #[prost(message, tag="30")]
        Payment(super::Payment),
        /// DEX transactions
        #[prost(message, tag="40")]
        OfferCreate(super::OfferCreate),
        #[prost(message, tag="41")]
        OfferCancel(super::OfferCancel),
        /// Trustline
        #[prost(message, tag="50")]
        TrustSet(super::TrustSet),
        /// Account management
        #[prost(message, tag="60")]
        AccountSet(super::AccountSet),
        #[prost(message, tag="61")]
        AccountDelete(super::AccountDelete),
        #[prost(message, tag="62")]
        SetRegularKey(super::SetRegularKey),
        #[prost(message, tag="63")]
        SignerListSet(super::SignerListSet),
        /// Escrow
        #[prost(message, tag="70")]
        EscrowCreate(super::EscrowCreate),
        #[prost(message, tag="71")]
        EscrowFinish(super::EscrowFinish),
        #[prost(message, tag="72")]
        EscrowCancel(super::EscrowCancel),
        /// Payment channels
        #[prost(message, tag="80")]
        PaymentChannelCreate(super::PaymentChannelCreate),
        #[prost(message, tag="81")]
        PaymentChannelFund(super::PaymentChannelFund),
        #[prost(message, tag="82")]
        PaymentChannelClaim(super::PaymentChannelClaim),
        /// Checks
        #[prost(message, tag="90")]
        CheckCreate(super::CheckCreate),
        #[prost(message, tag="91")]
        CheckCash(super::CheckCash),
        #[prost(message, tag="92")]
        CheckCancel(super::CheckCancel),
        /// Other account features
        #[prost(message, tag="100")]
        DepositPreauth(super::DepositPreauth),
        #[prost(message, tag="101")]
        TicketCreate(super::TicketCreate),
        /// NFT transactions
        #[prost(message, tag="110")]
        NftokenMint(super::NfTokenMint),
        #[prost(message, tag="111")]
        NftokenBurn(super::NfTokenBurn),
        #[prost(message, tag="112")]
        NftokenCreateOffer(super::NfTokenCreateOffer),
        #[prost(message, tag="113")]
        NftokenCancelOffer(super::NfTokenCancelOffer),
        #[prost(message, tag="114")]
        NftokenAcceptOffer(super::NfTokenAcceptOffer),
        #[prost(message, tag="115")]
        NftokenModify(super::NfTokenModify),
        /// Clawback
        #[prost(message, tag="120")]
        Clawback(super::Clawback),
        /// AMM transactions
        #[prost(message, tag="130")]
        AmmCreate(super::AmmCreate),
        #[prost(message, tag="131")]
        AmmDeposit(super::AmmDeposit),
        #[prost(message, tag="132")]
        AmmWithdraw(super::AmmWithdraw),
        #[prost(message, tag="133")]
        AmmVote(super::AmmVote),
        #[prost(message, tag="134")]
        AmmBid(super::AmmBid),
        #[prost(message, tag="135")]
        AmmDelete(super::AmmDelete),
        #[prost(message, tag="136")]
        AmmClawback(super::AmmClawback),
        /// DID transactions
        #[prost(message, tag="140")]
        DidSet(super::DidSet),
        #[prost(message, tag="141")]
        DidDelete(super::DidDelete),
        /// Oracle transactions
        #[prost(message, tag="150")]
        OracleSet(super::OracleSet),
        #[prost(message, tag="151")]
        OracleDelete(super::OracleDelete),
        /// MPToken transactions
        #[prost(message, tag="160")]
        MptokenIssuanceCreate(super::MpTokenIssuanceCreate),
        #[prost(message, tag="161")]
        MptokenIssuanceDestroy(super::MpTokenIssuanceDestroy),
        #[prost(message, tag="162")]
        MptokenIssuanceSet(super::MpTokenIssuanceSet),
        #[prost(message, tag="163")]
        MptokenAuthorize(super::MpTokenAuthorize),
        /// Credential transactions
        #[prost(message, tag="170")]
        CredentialCreate(super::CredentialCreate),
        #[prost(message, tag="171")]
        CredentialAccept(super::CredentialAccept),
        #[prost(message, tag="172")]
        CredentialDelete(super::CredentialDelete),
        /// Permissioned domain transactions
        #[prost(message, tag="180")]
        PermissionedDomainSet(super::PermissionedDomainSet),
        #[prost(message, tag="181")]
        PermissionedDomainDelete(super::PermissionedDomainDelete),
        /// Delegate transactions
        #[prost(message, tag="190")]
        DelegateSet(super::DelegateSet),
        /// Batch transaction
        #[prost(message, tag="200")]
        Batch(super::Batch),
        /// System transactions (pseudo-transactions)
        #[prost(message, tag="900")]
        EnableAmendment(super::EnableAmendment),
        #[prost(message, tag="901")]
        SetFee(super::SetFee),
        #[prost(message, tag="902")]
        UnlModify(super::UnlModify),
        #[prost(message, tag="903")]
        LedgerStateFix(super::LedgerStateFix),
    }
}
/// Memo attached to a transaction
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Memo {
    /// Arbitrary hex value, conventionally containing the content of the memo
    #[prost(string, tag="1")]
    pub memo_data: ::prost::alloc::string::String,
    /// Hex value representing characters allowed in URLs
    /// Conventionally containing information on how the memo is encoded
    #[prost(string, tag="2")]
    pub memo_format: ::prost::alloc::string::String,
    /// Hex value representing characters allowed in URLs
    /// Conventionally, a unique relation that defines the format of this memo
    #[prost(string, tag="3")]
    pub memo_type: ::prost::alloc::string::String,
}
// @@protoc_insertion_point(module)
