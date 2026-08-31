package xcs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
)

var hashPattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

type SchemaUIDInput struct {
	NetworkID        uint32           `json:"networkId"`
	LedgerHash       string           `json:"ledgerHash"`
	LedgerIndex      uint32           `json:"ledgerIndex"`
	TransactionIndex uint32           `json:"transactionIndex"`
	Publisher        string           `json:"publisher"`
	Schema           SchemaDefinition `json:"schema"`
}

func ParseSchemaUIDInput(data []byte) (SchemaUIDInput, error) {
	parsed, err := ParseJSON(data)
	if err != nil {
		return SchemaUIDInput{}, err
	}
	object, ok := parsed.(map[string]any)
	if !ok {
		return SchemaUIDInput{}, invalid("UID_INPUT_INVALID", "$", "must be an object")
	}
	networkID, err := requireJSONUint32(object, "networkId", "$", "UID_INPUT_INVALID")
	if err != nil {
		return SchemaUIDInput{}, err
	}
	ledgerIndex, err := requireJSONUint32(object, "ledgerIndex", "$", "UID_INPUT_INVALID")
	if err != nil {
		return SchemaUIDInput{}, err
	}
	transactionIndex, err := requireJSONUint32(object, "transactionIndex", "$", "UID_INPUT_INVALID")
	if err != nil {
		return SchemaUIDInput{}, err
	}

	var raw struct {
		NetworkID        json.RawMessage `json:"networkId"`
		LedgerHash       string          `json:"ledgerHash"`
		LedgerIndex      json.RawMessage `json:"ledgerIndex"`
		TransactionIndex json.RawMessage `json:"transactionIndex"`
		Publisher        string          `json:"publisher"`
		Schema           json.RawMessage `json:"schema"`
	}
	if err := decodeKnownJSON(data, &raw); err != nil {
		// ParseJSON above has already established that the wrapper is strict JSON.
		// Decoder failures here are therefore UID wrapper structure errors. The
		// nested schema remains RawMessage and is classified separately below.
		return SchemaUIDInput{}, invalid("UID_INPUT_INVALID", "$", "invalid UID input structure: %v", err)
	}
	if len(raw.Schema) == 0 {
		return SchemaUIDInput{}, invalid("SCHEMA_INVALID", "$.schema", "schema is required")
	}
	schema, err := ParseSchema(raw.Schema)
	if err != nil {
		return SchemaUIDInput{}, err
	}
	return SchemaUIDInput{
		NetworkID:        networkID,
		LedgerHash:       raw.LedgerHash,
		LedgerIndex:      ledgerIndex,
		TransactionIndex: transactionIndex,
		Publisher:        raw.Publisher,
		Schema:           schema,
	}, nil
}

func ComputeSchemaUID(input SchemaUIDInput) (string, []byte, error) {
	if !hashPattern.MatchString(input.LedgerHash) {
		return "", nil, invalid("UID_INPUT_INVALID", "$.ledgerHash", "must be a 32-byte hex hash")
	}
	if !IsClassicAddress(input.Publisher) {
		return "", nil, invalid("UID_INPUT_INVALID", "$.publisher", "must be an XRPL classic address")
	}
	if err := ValidateSchema(input.Schema); err != nil {
		return "", nil, err
	}
	preimage := map[string]any{
		"purpose":          "xcs.schema.uid",
		"version":          "0.1",
		"networkId":        input.NetworkID,
		"ledgerHash":       strings.ToLower(input.LedgerHash),
		"ledgerIndex":      input.LedgerIndex,
		"transactionIndex": input.TransactionIndex,
		"publisher":        input.Publisher,
		"schema":           schemaMap(input.Schema),
	}
	canonical, err := Canonicalize(preimage)
	if err != nil {
		return "", nil, err
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), canonical, nil
}
