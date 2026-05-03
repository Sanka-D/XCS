// Manually written prost types matching proto/xcs/v1/types.proto.
// Run `buf generate` to regenerate if the proto file changes.

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct XcsOperations {
    #[prost(message, repeated, tag = "1")]
    pub operations: ::prost::alloc::vec::Vec<XcsOperation>,
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct XcsOperation {
    #[prost(uint64, tag = "1")]
    pub ledger_index: u64,
    #[prost(uint32, tag = "2")]
    pub tx_index: u32,
    #[prost(string, tag = "3")]
    pub tx_hash: ::prost::alloc::string::String,
    #[prost(oneof = "xcs_operation::Op", tags = "4, 5, 6, 7")]
    pub op: ::core::option::Option<xcs_operation::Op>,
}

pub mod xcs_operation {
    #[allow(clippy::derive_partial_eq_without_eq)]
    #[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum Op {
        #[prost(message, tag = "4")]
        SchemaReg(super::SchemaRegistration),
        #[prost(message, tag = "5")]
        CredCreated(super::CredentialCreated),
        #[prost(message, tag = "6")]
        CredAccepted(super::CredentialAccepted),
        #[prost(message, tag = "7")]
        CredRevoked(super::CredentialRevoked),
    }
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SchemaRegistration {
    #[prost(string, tag = "1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub schema_json: ::prost::alloc::string::String,
    #[prost(string, tag = "3")]
    pub uid: ::prost::alloc::string::String,
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialCreated {
    #[prost(string, tag = "1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub subject: ::prost::alloc::string::String,
    #[prost(string, tag = "3")]
    pub credential_type: ::prost::alloc::string::String,
    #[prost(string, tag = "4")]
    pub uri: ::prost::alloc::string::String,
    #[prost(uint32, tag = "5")]
    pub expiration: u32,
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialAccepted {
    #[prost(string, tag = "1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub subject: ::prost::alloc::string::String,
    #[prost(string, tag = "3")]
    pub credential_type: ::prost::alloc::string::String,
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialRevoked {
    #[prost(string, tag = "1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub subject: ::prost::alloc::string::String,
    #[prost(string, tag = "3")]
    pub credential_type: ::prost::alloc::string::String,
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CredentialState {
    #[prost(string, tag = "1")]
    pub issuer: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub subject: ::prost::alloc::string::String,
    #[prost(string, tag = "3")]
    pub credential_type: ::prost::alloc::string::String,
    #[prost(string, tag = "4")]
    pub uri: ::prost::alloc::string::String,
    #[prost(uint32, tag = "5")]
    pub expiration: u32,
    #[prost(uint64, tag = "6")]
    pub created_ledger: u64,
    /// "created" | "accepted" | "revoked"
    #[prost(string, tag = "7")]
    pub status: ::prost::alloc::string::String,
}
