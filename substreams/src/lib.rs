mod pb;

use pb::sf::xrpl::r#type::v1::{transaction::TxDetails, Block};
use pb::xcs::v1::{
    xcs_operation::Op, CredentialAccepted, CredentialCreated, CredentialRevoked, CredentialState,
    SchemaRegistration, XcsOperation, XcsOperations,
};
use sha2::{Digest, Sha256};
use substreams::store::{
    StoreGet, StoreGetProto, StoreNew, StoreSet, StoreSetIfNotExists, StoreSetIfNotExistsProto,
    StoreSetProto,
};
use substreams_database_change::pb::database::DatabaseChanges;
use substreams_database_change::tables::Tables;

// ── XCS memo type constants ────────────────────────────────────────────────────
// XRPL memo_type is hex-encoded ASCII. We compare the decoded bytes.
const MEMO_SCHEMA_REGISTER: &[u8] = b"xcs:schema_register";
const MEMO_CREDENTIAL_CREATE: &[u8] = b"xcs:credential_create";

// ── Helpers ───────────────────────────────────────────────────────────────────

fn memo_type_matches(hex_str: &str, expected: &[u8]) -> bool {
    hex::decode(hex_str)
        .map(|b| b == expected)
        .unwrap_or(false)
}

/// Hex-decode memo_data and interpret as UTF-8.
fn decode_memo_data(hex_str: &str) -> Option<String> {
    hex::decode(hex_str)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
}

/// Compute the XCS schema UID per the white paper spec:
///   SHA256(schema_json_bytes || issuer_bytes || ledger_index_be64 || tx_index_be32)
fn compute_uid(schema_json: &str, issuer: &str, ledger_index: u64, tx_index: u32) -> String {
    let mut h = Sha256::new();
    h.update(schema_json.as_bytes());
    h.update(issuer.as_bytes());
    h.update(ledger_index.to_be_bytes());
    h.update(tx_index.to_be_bytes());
    hex::encode(h.finalize())
}

/// Uppercase hex hash, matching XRPL convention.
fn tx_hash(bytes: &[u8]) -> String {
    hex::encode_upper(bytes)
}

/// Credential store key: "{issuer}:{subject}:{credential_type}"
fn cred_key(issuer: &str, subject: &str, credential_type: &str) -> String {
    format!("{}:{}:{}", issuer, subject, credential_type)
}

// ── Module 1: map_schema_ops ──────────────────────────────────────────────────
//
// Scans every block for Payment transactions carrying an `xcs:schema_register`
// memo.  Emits one SchemaRegistration per valid registration so that
// store_schemas can build the schema index.

#[substreams::handlers::map]
fn map_schema_ops(block: Block) -> Result<XcsOperations, substreams::errors::Error> {
    let mut ops = Vec::new();

    for tx in &block.transactions {
        if tx.result != "tesSUCCESS" || tx.tx_type != "Payment" {
            continue;
        }

        let memo = match tx
            .memos
            .iter()
            .find(|m| memo_type_matches(&m.memo_type, MEMO_SCHEMA_REGISTER))
        {
            Some(m) => m,
            None => continue,
        };

        let schema_json = match decode_memo_data(&memo.memo_data) {
            Some(s) => s,
            None => {
                substreams::log::println(format!(
                    "ledger {}: invalid schema memo_data in tx {}",
                    block.number,
                    tx_hash(&tx.hash)
                ));
                continue;
            }
        };

        let uid = compute_uid(&schema_json, &tx.account, block.number, tx.index);

        ops.push(XcsOperation {
            ledger_index: block.number,
            tx_index: tx.index,
            tx_hash: tx_hash(&tx.hash),
            op: Some(Op::SchemaReg(SchemaRegistration {
                issuer: tx.account.clone(),
                schema_json,
                uid,
            })),
        });
    }

    Ok(XcsOperations { operations: ops })
}

// ── Store 1: store_schemas ────────────────────────────────────────────────────
//
// Accumulates schema registrations keyed by UID.
// set_if_not_exists ensures schemas are immutable once registered.

#[substreams::handlers::store]
fn store_schemas(ops: XcsOperations, store: StoreSetIfNotExistsProto<SchemaRegistration>) {
    for op in ops.operations {
        if let Some(Op::SchemaReg(schema)) = op.op {
            store.set_if_not_exists(op.ledger_index, &schema.uid, &schema);
        }
    }
}

// ── Module 2: map_xcs_ops ─────────────────────────────────────────────────────
//
// Emits the full set of XCS protocol events for a block:
//   - Schema registrations (re-computed, identical to map_schema_ops output)
//   - CredentialCreate (requires xcs:credential_create memo per protocol)
//   - CredentialAccept (validated against store_schemas)
//   - CredentialDelete (validated against store_schemas)
//
// The store_schemas parameter contains schemas from all *previous* blocks.
// Same-block schema → credential references are unusual but handled gracefully:
// the credential will appear as unvalidated in this block and the store will
// reflect it in the next block.

#[substreams::handlers::map]
fn map_xcs_ops(
    block: Block,
    schemas_store: StoreGetProto<SchemaRegistration>,
) -> Result<XcsOperations, substreams::errors::Error> {
    let mut ops = Vec::new();

    for tx in &block.transactions {
        if tx.result != "tesSUCCESS" {
            continue;
        }

        match tx.tx_type.as_str() {
            "Payment" => {
                let memo = match tx
                    .memos
                    .iter()
                    .find(|m| memo_type_matches(&m.memo_type, MEMO_SCHEMA_REGISTER))
                {
                    Some(m) => m,
                    None => continue,
                };

                if let Some(schema_json) = decode_memo_data(&memo.memo_data) {
                    let uid = compute_uid(&schema_json, &tx.account, block.number, tx.index);
                    ops.push(XcsOperation {
                        ledger_index: block.number,
                        tx_index: tx.index,
                        tx_hash: tx_hash(&tx.hash),
                        op: Some(Op::SchemaReg(SchemaRegistration {
                            issuer: tx.account.clone(),
                            schema_json,
                            uid,
                        })),
                    });
                }
            }

            "CredentialCreate" => {
                // xcs:credential_create memo is required by the XCS protocol.
                let has_xcs_memo = tx
                    .memos
                    .iter()
                    .any(|m| memo_type_matches(&m.memo_type, MEMO_CREDENTIAL_CREATE));

                if !has_xcs_memo {
                    continue;
                }

                if let Some(TxDetails::CredentialCreate(cred)) = &tx.tx_details {
                    ops.push(XcsOperation {
                        ledger_index: block.number,
                        tx_index: tx.index,
                        tx_hash: tx_hash(&tx.hash),
                        op: Some(Op::CredCreated(CredentialCreated {
                            issuer: tx.account.clone(),
                            subject: cred.subject.clone(),
                            credential_type: cred.credential_type.clone(),
                            uri: cred.uri.clone(),
                            expiration: cred.expiration,
                        })),
                    });
                }
            }

            "CredentialAccept" => {
                if let Some(TxDetails::CredentialAccept(cred)) = &tx.tx_details {
                    // Only emit if this credential_type is a known XCS schema.
                    if schemas_store.get_last(&cred.credential_type).is_some() {
                        ops.push(XcsOperation {
                            ledger_index: block.number,
                            tx_index: tx.index,
                            tx_hash: tx_hash(&tx.hash),
                            op: Some(Op::CredAccepted(CredentialAccepted {
                                issuer: cred.issuer.clone(),
                                // The tx submitter IS the subject accepting the credential.
                                subject: tx.account.clone(),
                                credential_type: cred.credential_type.clone(),
                            })),
                        });
                    }
                }
            }

            "CredentialDelete" => {
                if let Some(TxDetails::CredentialDelete(cred)) = &tx.tx_details {
                    if schemas_store.get_last(&cred.credential_type).is_some() {
                        // Either the issuer or the subject can submit a CredentialDelete.
                        // When the submitter IS the issuer, the Subject field carries the subject.
                        // When the submitter IS the subject, the Issuer field carries the issuer.
                        let issuer = if cred.issuer.is_empty() {
                            tx.account.clone()
                        } else {
                            cred.issuer.clone()
                        };
                        let subject = if cred.subject.is_empty() {
                            tx.account.clone()
                        } else {
                            cred.subject.clone()
                        };

                        ops.push(XcsOperation {
                            ledger_index: block.number,
                            tx_index: tx.index,
                            tx_hash: tx_hash(&tx.hash),
                            op: Some(Op::CredRevoked(CredentialRevoked {
                                issuer,
                                subject,
                                credential_type: cred.credential_type.clone(),
                            })),
                        });
                    }
                }
            }

            _ => {}
        }
    }

    Ok(XcsOperations { operations: ops })
}

// ── Store 2: store_credentials ────────────────────────────────────────────────
//
// Maintains the latest state per credential.
// Key: "{issuer}:{subject}:{credential_type}"
// Value: CredentialState with status "created" | "accepted" | "revoked"

#[substreams::handlers::store]
fn store_credentials(ops: XcsOperations, store: StoreSetProto<CredentialState>) {
    for op in ops.operations {
        match op.op {
            Some(Op::CredCreated(ref c)) => {
                let key = cred_key(&c.issuer, &c.subject, &c.credential_type);
                store.set(
                    op.ledger_index,
                    &key,
                    &CredentialState {
                        issuer: c.issuer.clone(),
                        subject: c.subject.clone(),
                        credential_type: c.credential_type.clone(),
                        uri: c.uri.clone(),
                        expiration: c.expiration,
                        created_ledger: op.ledger_index,
                        status: "created".into(),
                    },
                );
            }
            Some(Op::CredAccepted(ref c)) => {
                let key = cred_key(&c.issuer, &c.subject, &c.credential_type);
                store.set(
                    op.ledger_index,
                    &key,
                    &CredentialState {
                        issuer: c.issuer.clone(),
                        subject: c.subject.clone(),
                        credential_type: c.credential_type.clone(),
                        uri: String::new(),
                        expiration: 0,
                        created_ledger: 0,
                        status: "accepted".into(),
                    },
                );
            }
            Some(Op::CredRevoked(ref c)) => {
                let key = cred_key(&c.issuer, &c.subject, &c.credential_type);
                store.set(
                    op.ledger_index,
                    &key,
                    &CredentialState {
                        issuer: c.issuer.clone(),
                        subject: c.subject.clone(),
                        credential_type: c.credential_type.clone(),
                        uri: String::new(),
                        expiration: 0,
                        created_ledger: 0,
                        status: "revoked".into(),
                    },
                );
            }
            _ => {}
        }
    }
}

// ── Module 5: db_out ──────────────────────────────────────────────────────────
//
// Translates XcsOperations into DatabaseChanges for substreams-sink-sql.
//
// Table: schemas   — append-only, keyed by uid
// Table: credentials — mutable, keyed by "issuer:subject:credential_type"
//   status transitions: created → accepted → revoked

#[substreams::handlers::map]
fn db_out(ops: XcsOperations) -> Result<DatabaseChanges, substreams::errors::Error> {
    let mut tables = Tables::new();

    for op in ops.operations {
        match op.op {
            Some(Op::SchemaReg(ref s)) => {
                tables
                    .create_row("schemas", &s.uid)
                    .set("issuer", s.issuer.as_str())
                    .set("schema_json", s.schema_json.as_str())
                    .set("ledger_index", op.ledger_index)
                    .set("tx_index", op.tx_index as u64)
                    .set("tx_hash", op.tx_hash.as_str());
            }

            Some(Op::CredCreated(ref c)) => {
                let id = cred_key(&c.issuer, &c.subject, &c.credential_type);
                tables
                    .create_row("credentials", id.as_str())
                    .set("issuer", c.issuer.as_str())
                    .set("subject", c.subject.as_str())
                    .set("credential_type", c.credential_type.as_str())
                    .set("uri", c.uri.as_str())
                    .set("expiration", c.expiration as u64)
                    .set("created_ledger", op.ledger_index)
                    .set("status", "created")
                    .set("tx_hash", op.tx_hash.as_str());
            }

            Some(Op::CredAccepted(ref c)) => {
                let id = cred_key(&c.issuer, &c.subject, &c.credential_type);
                tables
                    .update_row("credentials", id.as_str())
                    .set("status", "accepted")
                    .set("tx_hash", op.tx_hash.as_str());
            }

            Some(Op::CredRevoked(ref c)) => {
                let id = cred_key(&c.issuer, &c.subject, &c.credential_type);
                tables
                    .update_row("credentials", id.as_str())
                    .set("status", "revoked")
                    .set("tx_hash", op.tx_hash.as_str());
            }

            _ => {}
        }
    }

    Ok(tables.to_database_changes())
}
