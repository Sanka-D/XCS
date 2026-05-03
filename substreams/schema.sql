-- XCS Protocol — tables managed by substreams-sink-sql
-- Run: substreams-sink-sql setup $DSN ./substreams.yaml

CREATE TABLE IF NOT EXISTS schemas (
    uid             TEXT        NOT NULL PRIMARY KEY,
    issuer          TEXT        NOT NULL,
    schema_json     JSONB       NOT NULL,
    ledger_index    BIGINT      NOT NULL,
    tx_index        INTEGER     NOT NULL,
    tx_hash         TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS schemas_issuer_idx ON schemas (issuer);

-- Credential state is mutable: status transitions created → accepted → revoked.
-- Primary key is a composite represented as "issuer:subject:credential_type".
CREATE TABLE IF NOT EXISTS credentials (
    id              TEXT        NOT NULL PRIMARY KEY,  -- "issuer:subject:credential_type"
    issuer          TEXT        NOT NULL,
    subject         TEXT        NOT NULL,
    credential_type TEXT        NOT NULL,
    uri             TEXT,
    expiration      BIGINT,
    created_ledger  BIGINT,
    status          TEXT        NOT NULL,              -- created | accepted | revoked
    tx_hash         TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS credentials_issuer_idx          ON credentials (issuer);
CREATE INDEX IF NOT EXISTS credentials_subject_idx         ON credentials (subject);
CREATE INDEX IF NOT EXISTS credentials_credential_type_idx ON credentials (credential_type);
CREATE INDEX IF NOT EXISTS credentials_status_idx          ON credentials (status);
