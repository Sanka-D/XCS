package xcs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func rawNetworkProfile(networkID string, activationLedgerIndex string) []byte {
	return []byte(fmt.Sprintf(`{
		"profileId":"xrpl-testnet-xcs-v0.1-json-number-test",
		"xcsVersion":"0.1",
		"networkId":%s,
		"requiredAmendment":"%s",
		"registryAddress":"%s",
		"registrationAmountDrops":"1",
		"activationLedgerIndex":%s,
		"activationLedgerHash":"%s"
	}`, networkID, repeatedHexByte('a'), catalogTestPublisher, activationLedgerIndex, repeatedHexByte('b')))
}

func rawSchemaUIDInput(networkID string, ledgerIndex string, transactionIndex string) []byte {
	return []byte(fmt.Sprintf(`{
		"networkId":%s,
		"ledgerHash":"%s",
		"ledgerIndex":%s,
		"transactionIndex":%s,
		"publisher":"%s",
		"schema":{
			"xcsVersion":"0.1",
			"name":"JSON number test",
			"description":"Exercises semantically integral uint32 JSON numbers.",
			"fields":{"courseId":{"type":"string"}}
		}
	}`, networkID, repeatedHexByte('c'), ledgerIndex, transactionIndex, catalogTestPublisher))
}

func requireUint32JSONError(t *testing.T, err error, code string, path string) {
	t.Helper()
	var protocolError *Error
	if !errors.As(err, &protocolError) || protocolError.Code != code || protocolError.Path != path {
		t.Fatalf("expected %s at %s, got %v", code, path, err)
	}
}

func replaceRequiredJSONNumber(t *testing.T, data []byte, from string, to string, count int) []byte {
	t.Helper()
	needle := []byte(from)
	if !bytes.Contains(data, needle) {
		t.Fatalf("test fixture does not contain %q", from)
	}
	return bytes.Replace(data, needle, []byte(to), count)
}

func TestNetworkProfileAcceptsSemanticUint32JSONNumbers(t *testing.T) {
	maximum := ^uint32(0)
	tests := []struct {
		name                  string
		networkID             string
		activationLedgerIndex string
		wantNetworkID         uint32
		wantActivation        uint32
	}{
		{name: "decimal notation", networkID: "1.0", activationLedgerIndex: "1.0", wantNetworkID: 1, wantActivation: 1},
		{name: "exponent notation", networkID: "1e0", activationLedgerIndex: "1e0", wantNetworkID: 1, wantActivation: 1},
		{name: "negative zero", networkID: "-0", activationLedgerIndex: "1", wantNetworkID: 0, wantActivation: 1},
		{name: "maximum", networkID: "4294967295.0", activationLedgerIndex: "4.294967295e9", wantNetworkID: maximum, wantActivation: maximum},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			profile, err := ParseNetworkProfile(rawNetworkProfile(test.networkID, test.activationLedgerIndex))
			if err != nil {
				t.Fatal(err)
			}
			if profile.NetworkID != test.wantNetworkID || profile.ActivationLedgerIndex != test.wantActivation {
				t.Fatalf("unexpected uint32 values: %#v", profile)
			}
		})
	}
}

func TestNetworkProfileRejectsInvalidSemanticUint32JSONNumbers(t *testing.T) {
	tests := []struct {
		name      string
		networkID string
		path      string
	}{
		{name: "fraction", networkID: "1.5", path: "$.networkId"},
		{name: "negative", networkID: "-1", path: "$.networkId"},
		{name: "overflow", networkID: "4294967296", path: "$.networkId"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseNetworkProfile(rawNetworkProfile(test.networkID, "1"))
			requireUint32JSONError(t, err, "NETWORK_PROFILE_INVALID", test.path)
		})
	}
}

func TestSchemaUIDInputAcceptsSemanticUint32JSONNumbers(t *testing.T) {
	maximum := ^uint32(0)
	tests := []struct {
		name  string
		wire  string
		value uint32
	}{
		{name: "decimal notation", wire: "1.0", value: 1},
		{name: "exponent notation", wire: "1e0", value: 1},
		{name: "negative zero", wire: "-0", value: 0},
		{name: "maximum", wire: "4.294967295e9", value: maximum},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input, err := ParseSchemaUIDInput(rawSchemaUIDInput(test.wire, test.wire, test.wire))
			if err != nil {
				t.Fatal(err)
			}
			if input.NetworkID != test.value || input.LedgerIndex != test.value || input.TransactionIndex != test.value {
				t.Fatalf("unexpected uint32 values: %#v", input)
			}
		})
	}
}

func TestSchemaUIDInputRejectsInvalidSemanticUint32JSONNumbers(t *testing.T) {
	tests := []struct {
		name             string
		networkID        string
		ledgerIndex      string
		transactionIndex string
		path             string
	}{
		{name: "network fraction", networkID: "1.5", ledgerIndex: "1", transactionIndex: "1", path: "$.networkId"},
		{name: "ledger negative", networkID: "1", ledgerIndex: "-1", transactionIndex: "1", path: "$.ledgerIndex"},
		{name: "transaction overflow", networkID: "1", ledgerIndex: "1", transactionIndex: "4294967296", path: "$.transactionIndex"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseSchemaUIDInput(rawSchemaUIDInput(test.networkID, test.ledgerIndex, test.transactionIndex))
			requireUint32JSONError(t, err, "UID_INPUT_INVALID", test.path)
		})
	}
}

func TestSchemaCatalogAcceptsSemanticUint32JSONNumbers(t *testing.T) {
	data, err := json.Marshal(catalogTestBundle(t))
	if err != nil {
		t.Fatal(err)
	}
	data = replaceRequiredJSONNumber(t, data, `"ledgerIndex":12`, `"ledgerIndex":12.0`, 1)
	data = replaceRequiredJSONNumber(t, data, `"ledgerIndex":10`, `"ledgerIndex":1e1`, -1)
	data = replaceRequiredJSONNumber(t, data, `"ledgerIndex":11`, `"ledgerIndex":11.0`, 1)
	data = replaceRequiredJSONNumber(t, data, `"transactionIndex":1`, `"transactionIndex":1.0`, 1)
	data = replaceRequiredJSONNumber(t, data, `"transactionIndex":2`, `"transactionIndex":2e0`, 1)
	data = replaceRequiredJSONNumber(t, data, `"transactionIndex":0`, `"transactionIndex":-0`, 1)

	parsed, err := ParseSchemaCatalogBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Checkpoint.LedgerIndex != 12 || parsed.Schemas[0].LedgerIndex != 10 ||
		parsed.Schemas[0].TransactionIndex != 1 || parsed.Schemas[1].TransactionIndex != 2 ||
		parsed.Schemas[2].TransactionIndex != 0 {
		t.Fatalf("unexpected catalog coordinates: %#v", parsed)
	}

	maximum := ^uint32(0)
	entry := catalogTestEntry(t, SchemaDefinition{
		XCSVersion: "0.1", Name: "Maximum coordinates", Description: "Exercises the inclusive uint32 upper bound.",
		Fields: map[string]FieldDescriptor{"courseId": {Type: "string"}},
	}, maximum, maximum)
	maximumBundle := SchemaCatalogBundleV1{
		Format: SchemaCatalogFormatV1, Profile: catalogTestProfile(), TargetUID: entry.UID,
		Checkpoint: SchemaCatalogCheckpointV1{LedgerIndex: maximum, LedgerHash: entry.LedgerHash},
		Schemas:    []SchemaCatalogEntryV1{entry},
	}
	data, err = json.Marshal(maximumBundle)
	if err != nil {
		t.Fatal(err)
	}
	data = replaceRequiredJSONNumber(t, data, `"ledgerIndex":4294967295`, `"ledgerIndex":4294967295.0`, -1)
	data = replaceRequiredJSONNumber(t, data, `"transactionIndex":4294967295`, `"transactionIndex":4.294967295e9`, 1)
	parsed, err = ParseSchemaCatalogBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Checkpoint.LedgerIndex != maximum || parsed.Schemas[0].LedgerIndex != maximum || parsed.Schemas[0].TransactionIndex != maximum {
		t.Fatalf("unexpected maximum catalog coordinates: %#v", parsed)
	}
}

func TestSchemaCatalogRejectsInvalidSemanticUint32JSONNumbers(t *testing.T) {
	base, err := json.Marshal(catalogTestBundle(t))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		from string
		to   string
		path string
	}{
		{name: "checkpoint overflow", from: `"ledgerIndex":12`, to: `"ledgerIndex":4294967296`, path: "$.checkpoint.ledgerIndex"},
		{name: "entry ledger fraction", from: `"ledgerIndex":10`, to: `"ledgerIndex":10.5`, path: "$.schemas[0].ledgerIndex"},
		{name: "transaction negative", from: `"transactionIndex":1`, to: `"transactionIndex":-1`, path: "$.schemas[0].transactionIndex"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data := replaceRequiredJSONNumber(t, base, test.from, test.to, 1)
			_, err := ParseSchemaCatalogBundle(data)
			requireUint32JSONError(t, err, "SCHEMA_CATALOG_INVALID", test.path)
		})
	}
}
